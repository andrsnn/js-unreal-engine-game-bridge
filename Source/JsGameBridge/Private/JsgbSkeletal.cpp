// Skeletal swaps: a skinned three.js mesh drawn as an Unreal skeletal mesh posed from the game's joints and morph
// targets each frame (Runtime/src/skeletal.ts sends them). The game keeps animating its own skeleton; Unreal skins
// on the GPU, so the mesh isn't deformed on the CPU and sent again every frame.
//
// Spaces. three.js skins a bind-pose vertex v as  v' = J_i v  (J_i: bindMatrixInverse * bone * boneInverse * bindMatrix,
// in the mesh's local space). Unreal skins a reference-pose vertex u as  u' = CS_i RefCS_i^-1 u. The importer put the
// same mesh into Unreal's reference pose through some fixed change of axes and units G (u = G v), which is fitted
// once from the joint positions of both poses. Then  CS_i = G J_i G^-1 RefCS_i , and the component sits at the
// object's transform with G^-1 in front of it, so u' maps back to the place three.js draws v'.
#include "JsgbSceneMirror.h"
#include "Dom/JsonObject.h"
#include "Components/PoseableMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Animation/MorphTarget.h"
#include "Rendering/SkeletalMeshRenderData.h"
#include "Rendering/SkeletalMeshLODRenderData.h"
#include "GameFramework/Actor.h"
#include "Materials/MaterialInstanceDynamic.h"

DEFINE_LOG_CATEGORY_STATIC(LogJsgbSkeletal, Log, All);

namespace
{
	constexpr double CmScale = 100.0;

	// Column-major 4x4 (element (row r, column c) at [c * 4 + r]), as three.js stores matrices.
	void Mul(const double* A, const double* B, double* Out)
	{
		double T[16];
		for (int32 C = 0; C < 4; ++C) for (int32 R = 0; R < 4; ++R)
		{
			double S = 0; for (int32 K = 0; K < 4; ++K) { S += A[K * 4 + R] * B[C * 4 + K]; }
			T[C * 4 + R] = S;
		}
		FMemory::Memcpy(Out, T, sizeof(T));
	}

	/** A column-major matrix as an Unreal transform: FMatrix keeps row vectors, so its rows are our columns. */
	FTransform ToTransform44(const double* X)
	{
		FMatrix M;
		for (int32 I = 0; I < 4; ++I) for (int32 J = 0; J < 4; ++J) { M.M[I][J] = X[I * 4 + J]; }
		return FTransform(M);
	}

	void ToColumnMajor(const FTransform& T, double* Out)
	{
		const FMatrix M = T.ToMatrixWithScale();
		for (int32 I = 0; I < 4; ++I) for (int32 J = 0; J < 4; ++J) { Out[I * 4 + J] = M.M[I][J]; }
	}

	double Det3(const double A[3][3])
	{
		return A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
	}

	bool Inverse3(const double A[3][3], double Out[3][3])
	{
		const double D = Det3(A);
		if (FMath::Abs(D) < 1e-12) { return false; }
		Out[0][0] = (A[1][1] * A[2][2] - A[1][2] * A[2][1]) / D; Out[0][1] = (A[0][2] * A[2][1] - A[0][1] * A[2][2]) / D; Out[0][2] = (A[0][1] * A[1][2] - A[0][2] * A[1][1]) / D;
		Out[1][0] = (A[1][2] * A[2][0] - A[1][0] * A[2][2]) / D; Out[1][1] = (A[0][0] * A[2][2] - A[0][2] * A[2][0]) / D; Out[1][2] = (A[0][2] * A[1][0] - A[0][0] * A[1][2]) / D;
		Out[2][0] = (A[1][0] * A[2][1] - A[1][1] * A[2][0]) / D; Out[2][1] = (A[0][1] * A[2][0] - A[0][0] * A[2][1]) / D; Out[2][2] = (A[0][0] * A[1][1] - A[0][1] * A[1][0]) / D;
		return true;
	}

	/** Least-squares fit u = s R v + t over joint pairs, R orthonormal (a reflection allowed: three.js is right handed,
	 *  Unreal left handed). G and its inverse come out column-major. Returns the RMS error in Unreal units. */
	double FitSimilarity(const TArray<FVector>& V, const TArray<FVector>& U, double* G, double* GInv)
	{
		const int32 N = V.Num();
		FVector Cv(0), Cu(0);
		for (int32 I = 0; I < N; ++I) { Cv += V[I]; Cu += U[I]; }
		Cv /= N; Cu /= N;
		double H[3][3] = {{0}}, C[3][3] = {{0}};
		for (int32 I = 0; I < N; ++I)
		{
			const FVector Dv = V[I] - Cv, Du = U[I] - Cu;
			for (int32 R = 0; R < 3; ++R) for (int32 K = 0; K < 3; ++K) { H[R][K] += Du[R] * Dv[K]; C[R][K] += Dv[R] * Dv[K]; }
		}
		double Ci[3][3], A[3][3] = {{0}};
		if (!Inverse3(C, Ci)) { return -1; }
		for (int32 R = 0; R < 3; ++R) for (int32 K = 0; K < 3; ++K) for (int32 L = 0; L < 3; ++L) { A[R][K] += H[R][L] * Ci[L][K]; }
		const double D = Det3(A);
		const double S = FMath::Pow(FMath::Abs(D), 1.0 / 3.0);
		if (S < 1e-9) { return -1; }
		double Rm[3][3];
		for (int32 R = 0; R < 3; ++R) for (int32 K = 0; K < 3; ++K) { Rm[R][K] = A[R][K] / S; }
		// Polar decomposition by averaging with the inverse transpose: converges to the nearest orthonormal matrix
		// and keeps the determinant's sign.
		for (int32 It = 0; It < 20; ++It)
		{
			double Inv[3][3];
			if (!Inverse3(Rm, Inv)) { break; }
			for (int32 R = 0; R < 3; ++R) for (int32 K = 0; K < 3; ++K) { Rm[R][K] = 0.5 * (Rm[R][K] + Inv[K][R]); }
		}
		const FVector T = Cu - FVector(
			S * (Rm[0][0] * Cv.X + Rm[0][1] * Cv.Y + Rm[0][2] * Cv.Z),
			S * (Rm[1][0] * Cv.X + Rm[1][1] * Cv.Y + Rm[1][2] * Cv.Z),
			S * (Rm[2][0] * Cv.X + Rm[2][1] * Cv.Y + Rm[2][2] * Cv.Z));
		FMemory::Memzero(G, sizeof(double) * 16); FMemory::Memzero(GInv, sizeof(double) * 16);
		for (int32 R = 0; R < 3; ++R)
		{
			for (int32 K = 0; K < 3; ++K) { G[K * 4 + R] = S * Rm[R][K]; GInv[K * 4 + R] = Rm[K][R] / S; }
			G[12 + R] = T[R];
		}
		G[15] = GInv[15] = 1;
		for (int32 R = 0; R < 3; ++R) { GInv[12 + R] = -(GInv[0 * 4 + R] * T.X + GInv[1 * 4 + R] * T.Y + GInv[2 * 4 + R] * T.Z); }
		double Err = 0;
		for (int32 I = 0; I < N; ++I)
		{
			const FVector& P = V[I];
			const FVector Q(G[0] * P.X + G[4] * P.Y + G[8] * P.Z + G[12], G[1] * P.X + G[5] * P.Y + G[9] * P.Z + G[13], G[2] * P.X + G[6] * P.Y + G[10] * P.Z + G[14]);
			Err += FVector::DistSquared(Q, U[I]);
		}
		return FMath::Sqrt(Err / N);
	}

	/** Names compared loosely: importers and three.js's loader rewrite different characters (spaces, dots, colons). */
	FString Loose(const FString& S)
	{
		FString Out; Out.Reserve(S.Len());
		for (TCHAR Ch : S) { if (FChar::IsAlnum(Ch)) { Out.AppendChar(FChar::ToLower(Ch)); } }
		return Out;
	}
}

UPoseableMeshComponent* UJsgbSceneMirror::NewPoseable()
{
	AActor* Owner = GetOwner();
	UPoseableMeshComponent* C = NewObject<UPoseableMeshComponent>(Owner);
	C->SetMobility(EComponentMobility::Movable);
	C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	C->SetGenerateOverlapEvents(false);
	C->bReceivesDecals = false;
	C->SetupAttachment(Owner->GetRootComponent());
	C->RegisterComponent();
	return C;
}

bool UJsgbSceneMirror::PoseSkeletal(FJsgbEntity& Ent, USkeletalMesh* Mesh, int32 KeyId, int32 NumSlots, int32 Joints, int32 Morphs, const float* Mats, const float* HideMaskIds,
	const float* JointData, const float* Weights, FTransform& OutOffset)
{
	const FJsgbSkeletonNames* Names = SkeletonNames.Find(KeyId);
	if (!Names || Names->Bones.Num() != Joints) { return false; }
	if (!Ent.Component) { Ent.Component = NewPoseable(); }
	UPoseableMeshComponent* C = CastChecked<UPoseableMeshComponent>(Ent.Component);
	FJsgbSkeletalPose& P = SkeletalPoses.FindOrAdd(Ent.Id);
	if (C->GetSkinnedAsset() != Mesh) { C->SetSkinnedAssetAndUpdate(Mesh); P = FJsgbSkeletalPose(); }
	const FReferenceSkeleton& Ref = Mesh->GetRefSkeleton();
	const int32 NumBones = Ref.GetNum();
	const float* BindPositions = JointData;
	const float* JointMatrices = JointData + 3 * Joints;
	if (!P.bFitted || P.Mesh.Get() != Mesh || P.Joints != Joints)
	{
		P = FJsgbSkeletalPose();
		P.Mesh = Mesh; P.Joints = Joints;
		TMap<FString, int32> BoneByName;
		for (int32 B = 0; B < NumBones; ++B) { BoneByName.Add(Loose(Ref.GetBoneName(B).ToString()), B); }
		P.RefCS.SetNum(NumBones);
		const TArray<FTransform>& Local = Ref.GetRefBonePose();
		for (int32 B = 0; B < NumBones; ++B) { const int32 Parent = Ref.GetParentIndex(B); P.RefCS[B] = Parent >= 0 ? Local[B] * P.RefCS[Parent] : Local[B]; }
		TArray<FVector> V, U;
		P.BoneOf.SetNum(Joints);
		for (int32 J = 0; J < Joints; ++J)
		{
			const int32* B = BoneByName.Find(Loose(Names->Bones[J]));
			P.BoneOf[J] = B ? *B : INDEX_NONE;
			if (B) { V.Add(FVector(BindPositions[J * 3], BindPositions[J * 3 + 1], BindPositions[J * 3 + 2])); U.Add(P.RefCS[*B].GetLocation()); }
		}
		if (V.Num() < 4)
		{
			UE_LOG(LogJsgbSkeletal, Warning, TEXT("Skeletal swap %s: only %d of %d joints found in %s"), *KeyNames.FindRef(KeyId), V.Num(), Joints, *Mesh->GetPathName());
			return false;
		}
		const double Err = FitSimilarity(V, U, P.G, P.GInv);
		if (Err < 0) { UE_LOG(LogJsgbSkeletal, Warning, TEXT("Skeletal swap %s: joints are degenerate"), *KeyNames.FindRef(KeyId)); return false; }
		// Offset. The mirror places objects with ToUE(M) = S M S^-1, S the axis swap with metres to cm, so a
		// world point is S M v. Here v = G^-1 u, so the component goes at ToUE(M) after S G^-1.
		const double S[16] = {CmScale, 0, 0, 0, 0, 0, CmScale, 0, 0, CmScale, 0, 0, 0, 0, 0, 1};
		double K[16];
		Mul(S, P.GInv, K);
		const double KL[3][3] = {{K[0], K[4], K[8]}, {K[1], K[5], K[9]}, {K[2], K[6], K[10]}};
		if (Det3(KL) <= 0)
		{
			UE_LOG(LogJsgbSkeletal, Warning, TEXT("Skeletal swap %s: the fitted axes are mirrored; check the import's handedness"), *KeyNames.FindRef(KeyId));
		}
		P.Offset = ToTransform44(K);
		P.MorphOf.Reset();
		P.SlotOf.Init(INDEX_NONE, Names->Slots.Num());
		const TArray<FSkeletalMaterial>& Slots = Mesh->GetMaterials();
		for (int32 I = 0; I < Names->Slots.Num(); ++I)
		{
			const FString Want = Loose(Names->Slots[I]);
			for (int32 Sl = 0; Sl < Slots.Num(); ++Sl)
			{
				bool bMatch = Loose(Slots[Sl].MaterialSlotName.ToString()) == Want;
#if WITH_EDITORONLY_DATA
				bMatch = bMatch || Loose(Slots[Sl].ImportedMaterialSlotName.ToString()) == Want; // editor builds only
#endif
				if (bMatch) { P.SlotOf[I] = Sl; break; }
			}
			if (P.SlotOf[I] == INDEX_NONE && Slots.Num() == Names->Slots.Num()) { P.SlotOf[I] = I; }
		}
		P.bFitted = true;
		UE_LOG(LogJsgbSkeletal, Display, TEXT("Skeletal swap %s -> %s: %d/%d joints, fit error %.3f cm, scale %.2f, %d slots"),
			*KeyNames.FindRef(KeyId), *Mesh->GetName(), V.Num(), Joints, Err, P.Offset.GetScale3D().X, Names->Slots.Num());
	}
	// Morph targets by name. The game's list for an asset can grow (a rig with targets of its own, such as a Sims 4
	// face), so the mapping is made again whenever its length changes.
	if (P.MorphOf.Num() != Names->Morphs.Num())
	{
		P.MorphOf.Init(INDEX_NONE, Names->Morphs.Num());
		const TArray<TObjectPtr<UMorphTarget>>& Targets = Mesh->GetMorphTargets();
		TMap<FString, int32> MorphByName;
		for (int32 M = 0; M < Targets.Num(); ++M) { if (Targets[M]) { MorphByName.Add(Loose(Targets[M]->GetName()), M); } }
		int32 Found = 0;
		for (int32 M = 0; M < Names->Morphs.Num(); ++M) { if (const int32* I = MorphByName.Find(Loose(Names->Morphs[M]))) { P.MorphOf[M] = *I; ++Found; } }
		UE_LOG(LogJsgbSkeletal, Display, TEXT("Skeletal swap %s -> %s: %d/%d morphs"), *KeyNames.FindRef(KeyId), *Mesh->GetName(), Found, Names->Morphs.Num());
	}
	OutOffset = P.Offset;

	// Pose: each joint's component-space transform from the game's, the rest of the skeleton follows its parents.
	TArray<FTransform> CS;
	CS.SetNum(NumBones);
	TBitArray<> Posed(false, NumBones);
	for (int32 J = 0; J < Joints; ++J)
	{
		const int32 B = P.BoneOf[J];
		if (B == INDEX_NONE) { continue; }
		double Jm[16], X[16];
		for (int32 I = 0; I < 16; ++I) { Jm[I] = JointMatrices[J * 16 + I]; }
		Mul(P.G, Jm, X);
		Mul(X, P.GInv, X);
		CS[B] = P.RefCS[B] * ToTransform44(X);
		Posed[B] = true;
	}
	const TArray<FTransform>& Local = Ref.GetRefBonePose();
	if (C->BoneSpaceTransforms.Num() != NumBones) { C->BoneSpaceTransforms = Local; }
	for (int32 B = 0; B < NumBones; ++B)
	{
		const int32 Parent = Ref.GetParentIndex(B);
		if (!Posed[B]) { CS[B] = Parent >= 0 ? Local[B] * CS[Parent] : Local[B]; }
		C->BoneSpaceTransforms[B] = Parent >= 0 ? CS[B].GetRelativeTransform(CS[Parent]) : CS[B];
	}
	C->MarkRefreshTransformDirty();

	// Morph targets: the game's influences, by name.
	const TArray<TObjectPtr<UMorphTarget>>& Targets = Mesh->GetMorphTargets();
	// -JsgbNoMorphs: every swap at its base shape (checks what the morph targets change, normals included).
	static const bool bNoMorphs = FParse::Param(FCommandLine::Get(), TEXT("JsgbNoMorphs"));
	if (Targets.Num() && !bNoMorphs)
	{
		C->MorphTargetWeights.SetNumZeroed(Targets.Num());
		for (float& W : C->MorphTargetWeights) { W = 0.f; }
		C->ActiveMorphTargets.Reset();
		for (int32 M = 0; M < FMath::Min(Morphs, P.MorphOf.Num()); ++M)
		{
			const int32 I = P.MorphOf[M];
			if (I == INDEX_NONE || FMath::Abs(Weights[M]) < 1e-4f || !Targets[I]) { continue; }
			C->MorphTargetWeights[I] = Weights[M];
			C->ActiveMorphTargets.Add(Targets[I], I);
		}
		C->MarkRenderDynamicDataDirty();
	}

	// Materials: the mirror's material for each primitive, in the slot named after the material it loaded with.
	// -1 hides the slot's sections (a hidden primitive, or a material rule that hides it). An asset registered with
	// "materials": "asset" keeps the skeletal mesh's own (Unreal-authored) materials; only hiding comes from the game.
	Ent.Materials.SetNum(NumSlots);
	bool bAssetMaterials = false;
	if (const TSharedPtr<FJsonObject> A = Asset(KeyId)) { FString Mode; bAssetMaterials = A->TryGetStringField(TEXT("materials"), Mode) && Mode == TEXT("asset"); }
	const FSkeletalMeshRenderData* Render = Mesh->GetResourceForRendering();
	for (int32 I = 0; I < NumSlots && I < P.SlotOf.Num(); ++I)
	{
		const int32 Slot = P.SlotOf[I];
		if (Slot == INDEX_NONE) { continue; }
		const int32 Mat = static_cast<int32>(Mats[I]);
		if (Ent.Materials[I] == Mat && (Mat < 0 || bAssetMaterials || C->GetMaterial(Slot) == MaterialFor(Mat))) { continue; }
		const bool bWasHidden = Ent.Materials[I] < 0;
		Ent.Materials[I] = Mat;
		if (Mat >= 0 && !bAssetMaterials) { if (UMaterialInstanceDynamic* Mid = MaterialFor(Mat)) { C->SetMaterial(Slot, Mid); if (Ent.HideMasks.IsValidIndex(I)) { Ent.HideMasks[I] = -1; } } }
		if (Render && Render->LODRenderData.Num() && (Mat < 0 || bWasHidden))
		{
			const TArray<FSkelMeshRenderSection>& Sections = Render->LODRenderData[0].RenderSections;
			for (int32 Sec = 0; Sec < Sections.Num(); ++Sec) { if (Sections[Sec].MaterialIndex == Slot) { C->ShowMaterialSection(Slot, Sec, Mat >= 0, 0); } }
		}
	}
	// Material variants on asset-material swaps (lifesim: a moved-in Sims 4 Sim's own skin and eyes on a shared Daz
	// body). The asset's "variants": {"<name>": {"<slot>": "<material>"}}; slots not named keep the asset's material.
	if (bAssetMaterials)
	{
		const FString Want = EntityVariants.FindRef(Ent.Id);
		if (Ent.Variant != Want)
		{
			const TSharedPtr<FJsonObject> A = Asset(KeyId);
			const TSharedPtr<FJsonObject>* Variants = nullptr;
			const TSharedPtr<FJsonObject>* Map = nullptr;
			const bool bHas = !Want.IsEmpty() && A && A->TryGetObjectField(TEXT("variants"), Variants) && (*Variants)->TryGetObjectField(Want, Map);
			const TArray<FSkeletalMaterial>& Own = Mesh->GetMaterials();
			Ent.HideMasks.SetNumZeroed(NumSlots);
			for (int32 Sl = 0; Sl < Own.Num(); ++Sl)
			{
				FString Path;
				UMaterialInterface* Mat = Own[Sl].MaterialInterface;
				if (bHas && (*Map)->TryGetStringField(Own[Sl].MaterialSlotName.ToString(), Path)) { if (UMaterialInterface* V = Resolve<UMaterialInterface>(Path)) { Mat = V; } }
				C->SetMaterial(Sl, Mat);
			}
			// The hide masks wrap the slot's material in an instance of their own: wrap the new ones again.
			for (int32 I = 0; I < Ent.HideMasks.Num(); ++I) { Ent.HideMasks[I] = -1; }
			Ent.Variant = Want;
			UE_LOG(LogJsgbSkeletal, Display, TEXT("Skeletal swap %s entity %d: material variant '%s'%s"), *KeyNames.FindRef(KeyId), Ent.Id, *Want, bHas || Want.IsEmpty() ? TEXT("") : TEXT(" (not in the registry)"));
		}
	}
	// Hidden triangles (the game dropped them from the primitive's index, as lifesim does under worn clothes): the
	// slot draws through its own instance of its material with HideMask set, which clips where the mask is white.
	Ent.HideMasks.SetNumZeroed(NumSlots);
	for (int32 I = 0; I < NumSlots && I < P.SlotOf.Num(); ++I)
	{
		const int32 Slot = P.SlotOf[I];
		const int32 MaskId = HideMaskIds ? static_cast<int32>(HideMaskIds[I]) : 0;
		if (Slot == INDEX_NONE || Ent.HideMasks[I] == MaskId) { continue; }
		if (Ent.HideMasks[I] < 0 && MaskId == 0) { Ent.HideMasks[I] = 0; continue; } // a fresh material has no mask
		const FJsgbTexture* T = MaskId > 0 ? Textures.Find(MaskId) : nullptr;
		if (MaskId > 0 && (!T || !T->Texture)) { continue; } // not uploaded yet: try again next frame
		UMaterialInterface* Current = C->GetMaterial(Slot);
		UMaterialInstanceDynamic* Mid = Cast<UMaterialInstanceDynamic>(Current);
		if (!Mid || Mid->GetOuter() != C) { if (!Current) { continue; } Mid = UMaterialInstanceDynamic::Create(Current, C); C->SetMaterial(Slot, Mid); }
		Mid->SetScalarParameterValue(TEXT("HasHideMask"), T ? 1.f : 0.f);
		if (T) { Mid->SetTextureParameterValue(TEXT("HideMask"), T->Texture); }
		Ent.HideMasks[I] = MaskId;
	}
	return true;
}
