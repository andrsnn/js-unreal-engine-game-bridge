#include "JsgbSceneMirror.h"
#include "JsgbBridge.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "Components/StaticMeshComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/SpotLightComponent.h"
#include "Components/LineBatchComponent.h"
#include "Camera/CameraComponent.h"
#include "Camera/CameraShakeBase.h"
#include "Camera/PlayerCameraManager.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetMaterialLibrary.h"
#include "Materials/Material.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialParameterCollection.h"
#include "MaterialShared.h"
#include "NiagaraComponent.h"
#include "NiagaraFunctionLibrary.h"
#include "NiagaraSystem.h"
#include "Sound/SoundBase.h"
#include "Engine/Texture2D.h"
#include "Engine/VolumeTexture.h"
#include "ImageUtils.h"
#include "MeshDescription.h"
#include "StaticMeshAttributes.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "HAL/PlatformTime.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#if WITH_EDITOR
#include "MaterialDomain.h"
#include "Materials/MaterialExpressionCustom.h"
#include "Materials/MaterialExpressionLocalPosition.h"
#include "Materials/MaterialExpressionWorldPosition.h"
#include "Materials/MaterialExpressionTransform.h"
#include "Materials/MaterialExpressionTransformPosition.h"
#include "Materials/MaterialExpressionConstant3Vector.h"
#include "Materials/MaterialExpressionVertexNormalWS.h"
#include "Materials/MaterialExpressionTextureCoordinate.h"
#include "Materials/MaterialExpressionVertexColor.h"
#include "Materials/MaterialExpressionVectorParameter.h"
#include "Materials/MaterialExpressionScalarParameter.h"
#include "Materials/MaterialExpressionCollectionParameter.h"
#include "Materials/MaterialExpressionTextureObjectParameter.h"
#include "Materials/MaterialExpressionComponentMask.h"
#include "Materials/MaterialExpressionMultiply.h"
#include "Materials/MaterialExpressionAppendVector.h"
#endif

DEFINE_LOG_CATEGORY_STATIC(LogJsgbMirror, Log, All);

namespace
{
	constexpr float Cm = 100.f;
	constexpr int32 HeaderFloats = 88;
	enum ERecord { RMesh = 1, RInstanced = 2, RLight = 3, RSprite = 4, RPoints = 5, RLines = 6, RAsset = 7, REffect = 8 };
	enum EVariant { VLit, VLit2S, VMasked, VTrans, VUnlit, VUnlitTrans, VAdditive, VUnlitMasked, VBillboard, VBillboardAdd, VCount };
	const TCHAR* VariantPaths[VCount] = {
		TEXT("/JsGameBridge/Mirror/M_JsgbLit.M_JsgbLit"), TEXT("/JsGameBridge/Mirror/M_JsgbLit2S.M_JsgbLit2S"), TEXT("/JsGameBridge/Mirror/M_JsgbMasked.M_JsgbMasked"),
		TEXT("/JsGameBridge/Mirror/M_JsgbTrans.M_JsgbTrans"), TEXT("/JsGameBridge/Mirror/M_JsgbUnlit.M_JsgbUnlit"), TEXT("/JsGameBridge/Mirror/M_JsgbUnlitTrans.M_JsgbUnlitTrans"),
		TEXT("/JsGameBridge/Mirror/M_JsgbAdditive.M_JsgbAdditive"), TEXT("/JsGameBridge/Mirror/M_JsgbUnlitMasked.M_JsgbUnlitMasked"),
		TEXT("/JsGameBridge/Mirror/M_JsgbBillboard.M_JsgbBillboard"), TEXT("/JsGameBridge/Mirror/M_JsgbBillboardAdd.M_JsgbBillboardAdd")};
	const TCHAR* GlobalsPath = TEXT("/JsGameBridge/Mirror/MPC_JsgbScene.MPC_JsgbScene");

	FORCEINLINE FVector3f Pos(const float* P) { return FVector3f(P[0] * Cm, P[2] * Cm, P[1] * Cm); }
	FORCEINLINE FVector3f Dir(const float* P) { return FVector3f(P[0], P[2], P[1]); }

	/** Three.js column-major matrixWorld to an Unreal matrix (Y and Z swapped, units to cm). */
	FMatrix ToUE(const float* E)
	{
		static const int32 P[4] = {0, 2, 1, 3};
		FMatrix M;
		for (int32 I = 0; I < 4; ++I) for (int32 J = 0; J < 4; ++J) { M.M[I][J] = E[P[I] * 4 + P[J]]; }
		M.M[3][0] *= Cm; M.M[3][1] *= Cm; M.M[3][2] *= Cm;
		return M;
	}

	FTransform ToTransform(const float* E)
	{
		FTransform T(ToUE(E));
		if (T.GetScale3D().IsNearlyZero(1e-6)) { T.SetScale3D(FVector(1e-4)); }
		return T;
	}

	TSharedPtr<FJsonObject> ParseJson(const FString& Text)
	{
		TSharedPtr<FJsonObject> Obj;
		FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), Obj);
		return Obj;
	}

	FLinearColor JsonColor(const TSharedPtr<FJsonObject>& O, const TCHAR* Key, FLinearColor Default)
	{
		const TArray<TSharedPtr<FJsonValue>>* A = nullptr;
		if (!O->TryGetArrayField(Key, A) || A->Num() < 3) { return Default; }
		return FLinearColor((*A)[0]->AsNumber(), (*A)[1]->AsNumber(), (*A)[2]->AsNumber(), 1.f);
	}

	double Num(const TSharedPtr<FJsonObject>& O, const TCHAR* Key, double Default = 0)
	{
		double V = Default;
		return O && O->TryGetNumberField(Key, V) ? V : Default;
	}
	bool Flag(const TSharedPtr<FJsonObject>& O, const TCHAR* Key)
	{
		bool V = false;
		return O && O->TryGetBoolField(Key, V) && V;
	}
	FString Str(const TSharedPtr<FJsonObject>& O, const TCHAR* Key)
	{
		FString V;
		if (O) { O->TryGetStringField(Key, V); }
		return V;
	}

	template <typename T>
	void CopyBuffer(TArray<T>& Out, const FArrayBuffer& B)
	{
		const int64 N = B.Data ? static_cast<int64>(B.Length / sizeof(T)) : 0;
		Out.SetNumUninitialized(N);
		if (N > 0) { FMemory::Memcpy(Out.GetData(), B.Data, N * sizeof(T)); }
	}
}

UJsgbSceneMirror::UJsgbSceneMirror()
{
	PrimaryComponentTick.bCanEverTick = false;
}

UMaterialInterface* UJsgbSceneMirror::ParentFor(int32 Variant)
{
	if (Parents.Num() == 0)
	{
		Parents.SetNum(VCount);
		for (int32 I = 0; I < VCount; ++I) { Parents[I] = LoadObject<UMaterialInterface>(nullptr, VariantPaths[I], nullptr, LOAD_NoWarn | LOAD_Quiet); }
		Fallback = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
		Globals = LoadObject<UMaterialParameterCollection>(nullptr, GlobalsPath, nullptr, LOAD_NoWarn | LOAD_Quiet);
		if (!Parents[VLit]) { UE_LOG(LogJsgbMirror, Warning, TEXT("JsGameBridge mirror materials missing; drawing with BasicShapeMaterial. Run Tools/materials/make_materials.py.")); }
		UWorld* World = GetWorld();
		const ERHIFeatureLevel::Type Level = World ? World->GetFeatureLevel() : GMaxRHIFeatureLevel;
		for (UMaterialInterface* P : Parents)
		{
			UMaterial* M = P ? P->GetMaterial() : nullptr;
			FMaterialResource* R = M ? M->GetMaterialResource(GMaxRHIShaderPlatform) : nullptr;
			if (!R) { continue; }
			R->FinishCompilation();
			for (const FString& E : R->GetCompileErrors()) { UE_LOG(LogJsgbMirror, Error, TEXT("%s: %s"), *M->GetName(), *E); }
		}
	}
	UMaterialInterface* P = Parents.IsValidIndex(Variant) ? Parents[Variant].Get() : nullptr;
	return P ? P : (Parents[VLit] ? Parents[VLit].Get() : Fallback.Get());
}

bool UJsgbSceneMirror::SetAssetRegistry(const FString& Json)
{
	TSharedPtr<FJsonObject> Root = ParseJson(Json);
	const TSharedPtr<FJsonObject>* Map = nullptr;
	if (!Root || !Root->TryGetObjectField(TEXT("assets"), Map)) { return false; }
	Registry.Reset();
	for (const auto& Pair : (*Map)->Values) { if (Pair.Value->Type == EJson::Object) { Registry.Add(FString(*Pair.Key), Pair.Value->AsObject()); } }
	UE_LOG(LogJsgbMirror, Display, TEXT("Asset registry: %d keys"), Registry.Num());
	return true;
}

TSharedPtr<FJsonObject> UJsgbSceneMirror::Asset(int32 KeyId) const
{
	const FString* Name = KeyNames.Find(KeyId);
	return Name ? Registry.FindRef(*Name) : nullptr;
}

void UJsgbSceneMirror::SetGeometry(int32 Id, const FArrayBuffer& Positions, const FArrayBuffer& Normals, const FArrayBuffer& UVs, const FArrayBuffer& Colors, int32 ColorSize, const FArrayBuffer& Indices, const FString& Groups)
{
	TSharedPtr<FJsgbPendingGeometry> G = MakeShared<FJsgbPendingGeometry>();
	CopyBuffer(G->Positions, Positions);
	CopyBuffer(G->Normals, Normals);
	CopyBuffer(G->UVs, UVs);
	CopyBuffer(G->Colors, Colors);
	CopyBuffer(G->Indices, Indices);
	G->ColorSize = ColorSize;
	if (TSharedPtr<FJsonObject> J = ParseJson(Groups))
	{
		G->DrawStart = static_cast<int32>(Num(J, TEXT("drawStart")));
		G->DrawCount = static_cast<int32>(Num(J, TEXT("drawCount"), -1));
		G->Primitive = static_cast<int32>(Num(J, TEXT("primitive")));
		G->UVChannels = FMath::Clamp(static_cast<int32>(Num(J, TEXT("uvChannels"), 1)), 1, 8);
		const TArray<TSharedPtr<FJsonValue>>* A = nullptr;
		if (J->TryGetArrayField(TEXT("groups"), A))
		{
			for (const TSharedPtr<FJsonValue>& V : *A)
			{
				const TArray<TSharedPtr<FJsonValue>>& T = V->AsArray();
				if (T.Num() >= 3)
				{
					// A negative (or null) count runs to the end of the buffer, as three.js treats Infinity.
					const double Count = T[1]->Type == EJson::Number ? T[1]->AsNumber() : -1.0;
					G->Groups.Add(FIntVector(static_cast<int32>(T[0]->AsNumber()), Count < 0 ? MAX_int32 : static_cast<int32>(FMath::Min<double>(Count, MAX_int32)), static_cast<int32>(T[2]->AsNumber())));
				}
			}
		}
	}
	FJsgbGeometry& Geo = Geometries.FindOrAdd(Id);
	Geo.Primitive = G->Primitive;
	if (G->Primitive >= 2)
	{
		// Lines skip mesh building: the line batcher draws their points directly.
		const int32 NumVerts = G->Positions.Num() / 3;
		const bool bIndexed = G->Indices.Num() > 0;
		const int32 Elements = bIndexed ? G->Indices.Num() : NumVerts;
		const int32 Start = FMath::Clamp(G->DrawStart, 0, Elements), End = G->DrawCount < 0 ? Elements : FMath::Clamp(G->DrawStart + G->DrawCount, 0, Elements);
		TArray<int32> Order;
		for (int32 K = Start; K < End; ++K) { const int32 I = bIndexed ? static_cast<int32>(G->Indices[K]) : K; if (I < NumVerts) { Order.Add(I); } }
		TArray<int32> Pairs;
		if (G->Primitive == 2) { for (int32 K = 0; K + 1 < Order.Num(); K += 2) { Pairs.Add(Order[K]); Pairs.Add(Order[K + 1]); } }
		else { for (int32 K = 0; K + 1 < Order.Num(); ++K) { Pairs.Add(Order[K]); Pairs.Add(Order[K + 1]); } if (G->Primitive == 4 && Order.Num() > 2) { Pairs.Add(Order.Last()); Pairs.Add(Order[0]); } }
		Geo.LinePoints.Reset(Pairs.Num());
		Geo.LineColors.Reset(Pairs.Num());
		const bool bColors = G->ColorSize >= 3 && G->Colors.Num() >= NumVerts * G->ColorSize;
		for (int32 I : Pairs)
		{
			Geo.LinePoints.Add(FVector3f(G->Positions[I * 3], G->Positions[I * 3 + 1], G->Positions[I * 3 + 2]));
			Geo.LineColors.Add(bColors ? FLinearColor(G->Colors[I * G->ColorSize], G->Colors[I * G->ColorSize + 1], G->Colors[I * G->ColorSize + 2]) : FLinearColor::White);
		}
		++Geo.Revision;
		Geo.BuiltRevision = Geo.Revision;
		Geo.Pending.Reset();
		return;
	}
	Geo.Pending = G;
	++Geo.Revision;
	BuildQueue.AddUnique(Id);
}

void UJsgbSceneMirror::ReleaseGeometry(int32 Id)
{
	Geometries.Remove(Id);
	BuildQueue.Remove(Id);
}

UStaticMesh* UJsgbSceneMirror::BuildMesh(const FJsgbPendingGeometry& G, int32& OutSlots)
{
	const int32 SourceVerts = G.Positions.Num() / 3;
	if (SourceVerts < (G.Primitive == 1 ? 1 : 3)) { return nullptr; }
	const bool bPoints = G.Primitive == 1;
	const bool bIndexed = !bPoints && G.Indices.Num() > 0;
	const int32 ElementCount = bIndexed ? G.Indices.Num() : SourceVerts;
	const int32 RangeStart = FMath::Clamp(G.DrawStart, 0, ElementCount);
	const int32 RangeEnd = G.DrawCount < 0 ? ElementCount : FMath::Clamp(G.DrawStart + G.DrawCount, 0, ElementCount);

	TArray<FIntVector> Groups = G.Groups;
	if (Groups.Num() == 0 || bPoints) { Groups.Reset(); Groups.Add(FIntVector(0, ElementCount, 0)); }
	int32 Slots = 1;
	for (const FIntVector& Gr : Groups) { Slots = FMath::Max(Slots, Gr.Z + 1); }
	Slots = FMath::Min(Slots, 32);

	FMeshDescription MD;
	FStaticMeshAttributes Attr(MD);
	Attr.Register();
	TVertexAttributesRef<FVector3f> VPos = Attr.GetVertexPositions();
	TVertexInstanceAttributesRef<FVector3f> VNrm = Attr.GetVertexInstanceNormals();
	TVertexInstanceAttributesRef<FVector2f> VUV = Attr.GetVertexInstanceUVs();
	TVertexInstanceAttributesRef<FVector4f> VCol = Attr.GetVertexInstanceColors();
	TPolygonGroupAttributesRef<FName> SlotNames = Attr.GetPolygonGroupMaterialSlotNames();
	const bool bNormals = G.Normals.Num() >= SourceVerts * 3;
	const int32 UVN = G.UVChannels;
	const bool bUVs = G.UVs.Num() >= SourceVerts * 2 * UVN;
	if (UVN > 1) { VUV.SetNumChannels(UVN); }
	auto ExtraUVs = [&](const FVertexInstanceID& VI, int32 I) { for (int32 Ch = 1; Ch < UVN && bUVs; ++Ch) { VUV.Set(VI, Ch, FVector2f(G.UVs[(I * UVN + Ch) * 2], G.UVs[(I * UVN + Ch) * 2 + 1])); } };
	const bool bColors = G.ColorSize >= 3 && G.Colors.Num() >= SourceVerts * G.ColorSize;
	auto ColorAt = [&](int32 I) { return bColors ? FVector4f(G.Colors[I * G.ColorSize], G.Colors[I * G.ColorSize + 1], G.Colors[I * G.ColorSize + 2], G.ColorSize > 3 ? G.Colors[I * G.ColorSize + 3] : 1.f) : FVector4f(1, 1, 1, 1); };

	TArray<FPolygonGroupID> PolyGroups;
	for (int32 S = 0; S < Slots; ++S)
	{
		const FPolygonGroupID PG = MD.CreatePolygonGroup();
		SlotNames[PG] = FName(*FString::Printf(TEXT("S%d"), S));
		PolyGroups.Add(PG);
	}
	int32 Triangles = 0;
	if (bPoints)
	{
		// Each point becomes a quad whose corners share the point's position; the billboard
		// material spreads them along the camera's axes by the material's point size.
		const int32 Points = RangeEnd - RangeStart;
		MD.ReserveNewVertices(Points * 4);
		MD.ReserveNewVertexInstances(Points * 4);
		MD.ReserveNewTriangles(Points * 2);
		static const FVector2f Corners[4] = {FVector2f(0, 0), FVector2f(1, 0), FVector2f(1, 1), FVector2f(0, 1)};
		for (int32 P = RangeStart; P < RangeEnd; ++P)
		{
			FVertexInstanceID Q[4];
			for (int32 C = 0; C < 4; ++C)
			{
				const FVertexID V = MD.CreateVertex();
				// A millimetre of real extent keeps the mesh build from dropping the quad as degenerate;
				// the billboard material does the actual sizing.
				VPos[V] = Pos(&G.Positions[P * 3]) + FVector3f((Corners[C].X - 0.5f) * 0.1f, (Corners[C].Y - 0.5f) * 0.1f, 0.f);
				Q[C] = MD.CreateVertexInstance(V);
				VNrm[Q[C]] = FVector3f::UpVector;
				VUV.Set(Q[C], 0, Corners[C]);
				ExtraUVs(Q[C], P);
				VCol[Q[C]] = ColorAt(P);
			}
			const FVertexInstanceID A[3] = {Q[0], Q[1], Q[2]}, B[3] = {Q[0], Q[2], Q[3]};
			MD.CreateTriangle(PolyGroups[0], TArrayView<const FVertexInstanceID>(A, 3));
			MD.CreateTriangle(PolyGroups[0], TArrayView<const FVertexInstanceID>(B, 3));
			Triangles += 2;
		}
	}
	else
	{
		MD.ReserveNewVertices(SourceVerts);
		MD.ReserveNewVertexInstances(SourceVerts);
		MD.ReserveNewTriangles((RangeEnd - RangeStart) / 3);
		for (int32 I = 0; I < SourceVerts; ++I)
		{
			const FVertexID V = MD.CreateVertex();
			VPos[V] = Pos(&G.Positions[I * 3]);
			const FVertexInstanceID VI = MD.CreateVertexInstance(V);
			VNrm[VI] = bNormals ? Dir(&G.Normals[I * 3]) : FVector3f::UpVector;
			VUV.Set(VI, 0, bUVs ? FVector2f(G.UVs[I * 2 * UVN], G.UVs[I * 2 * UVN + 1]) : FVector2f::ZeroVector);
			ExtraUVs(VI, I);
			VCol[VI] = ColorAt(I);
		}
		for (const FIntVector& Gr : Groups)
		{
			const int32 A = FMath::Max(Gr.X, RangeStart);
			const int32 B = FMath::Min<int64>(static_cast<int64>(Gr.X) + Gr.Y, RangeEnd);
			const FPolygonGroupID PG = PolyGroups[FMath::Clamp(Gr.Z, 0, Slots - 1)];
			for (int32 K = A; K + 2 < B; K += 3)
			{
				const uint32 I0 = bIndexed ? G.Indices[K] : K, I1 = bIndexed ? G.Indices[K + 1] : K + 1, I2 = bIndexed ? G.Indices[K + 2] : K + 2;
				if (I0 >= static_cast<uint32>(SourceVerts) || I1 >= static_cast<uint32>(SourceVerts) || I2 >= static_cast<uint32>(SourceVerts)) { continue; }
				if (I0 == I1 || I1 == I2 || I0 == I2) { continue; }
				// Three.js front faces are counter-clockwise in a right-handed space. Swapping Y and Z
				// mirrors it into Unreal's left-handed space, where the same order is the front face.
				const FVertexInstanceID Tri[3] = {FVertexInstanceID(I0), FVertexInstanceID(I1), FVertexInstanceID(I2)};
				MD.CreateTriangle(PG, TArrayView<const FVertexInstanceID>(Tri, 3));
				++Triangles;
			}
		}
	}
	if (Triangles == 0) { return nullptr; }

	UStaticMesh* SM = NewObject<UStaticMesh>(this, NAME_None, RF_Transient);
	for (int32 S = 0; S < Slots; ++S)
	{
		const FName Name(*FString::Printf(TEXT("S%d"), S));
		SM->GetStaticMaterials().Add(FStaticMaterial(nullptr, Name, Name));
	}
	UStaticMesh::FBuildMeshDescriptionsParams Params;
	Params.bFastBuild = true;
	Params.bBuildSimpleCollision = false;
	Params.bAllowCpuAccess = false;
	Params.bMarkPackageDirty = false;
	Params.bCommitMeshDescription = false;
	TArray<const FMeshDescription*> Lods = {&MD};
	if (!SM->BuildFromMeshDescriptions(Lods, Params)) { return nullptr; }
	OutSlots = Slots;
	return SM;
}

UStaticMesh* UJsgbSceneMirror::SpriteQuad()
{
	if (!Quad)
	{
		FJsgbPendingGeometry G;
		G.Primitive = 1;
		G.Positions = {0.f, 0.f, 0.f};
		int32 Slots = 1;
		Quad = BuildMesh(G, Slots);
	}
	return Quad;
}

void UJsgbSceneMirror::SetTexture(int32 Id, const FString& Json, const FArrayBuffer& Bytes)
{
	TSharedPtr<FJsonObject> J = ParseJson(Json);
	if (!J) { return; }
	FJsgbTexture& T = Textures.FindOrAdd(Id);
	const FString Kind = Str(J, TEXT("kind"));
	UTexture2D* Tex = nullptr;
	if (Kind == TEXT("file"))
	{
		FArrayBufferValue Data;
		if (Bridge) { Data = Bridge->ReadFile(Str(J, TEXT("path"))); }
		if (Data.Data.Num() > 0) { Tex = FImageUtils::ImportBufferAsTexture2D(Data.Data); }
	}
	else if (Kind == TEXT("encoded") && Bytes.Data && Bytes.Length > 0)
	{
		Tex = FImageUtils::ImportBufferAsTexture2D(TArrayView64<const uint8>(static_cast<const uint8*>(Bytes.Data), Bytes.Length));
	}
	else if (Kind == TEXT("rgba8") && Bytes.Data)
	{
		const int32 W = static_cast<int32>(Num(J, TEXT("width"))), H = static_cast<int32>(Num(J, TEXT("height")));
		if (W > 0 && H > 0 && Bytes.Length >= static_cast<size_t>(W) * H * 4)
		{
			Tex = UTexture2D::CreateTransient(W, H, PF_R8G8B8A8);
			if (Tex)
			{
				void* Mip = Tex->GetPlatformData()->Mips[0].BulkData.Lock(LOCK_READ_WRITE);
				FMemory::Memcpy(Mip, Bytes.Data, static_cast<SIZE_T>(W) * H * 4);
				Tex->GetPlatformData()->Mips[0].BulkData.Unlock();
			}
		}
	}
	if (Tex)
	{
		Tex->SRGB = Flag(J, TEXT("srgb"));
		Tex->Filter = Flag(J, TEXT("nearest")) ? TF_Nearest : TF_Bilinear;
		const double WrapS = Num(J, TEXT("wrapS")), WrapT = Num(J, TEXT("wrapT"));
		Tex->AddressX = WrapS == 1001 ? TA_Clamp : WrapS == 1002 ? TA_Mirror : TA_Wrap;
		Tex->AddressY = WrapT == 1001 ? TA_Clamp : WrapT == 1002 ? TA_Mirror : TA_Wrap;
		Tex->UpdateResource();
	}
	UTexture* Result = Tex;
	if (Kind == TEXT("rgba8_3d") && Bytes.Data)
	{
		// Data3DTexture (noise volumes for custom shaders): a transient volume texture.
		const int32 W = static_cast<int32>(Num(J, TEXT("width"))), H = static_cast<int32>(Num(J, TEXT("height"))), D3 = static_cast<int32>(Num(J, TEXT("depth")));
		if (W > 0 && H > 0 && D3 > 0 && Bytes.Length >= static_cast<size_t>(W) * H * D3 * 4)
		{
			UVolumeTexture* V = NewObject<UVolumeTexture>(GetTransientPackage(), NAME_None, RF_Transient);
			FTexturePlatformData* PD = new FTexturePlatformData();
			PD->SizeX = W; PD->SizeY = H; PD->SetNumSlices(D3); PD->PixelFormat = PF_R8G8B8A8;
			FTexture2DMipMap* Mip = new FTexture2DMipMap(W, H, D3);
			Mip->BulkData.Lock(LOCK_READ_WRITE);
			void* Dest = Mip->BulkData.Realloc(static_cast<int64>(W) * H * D3 * 4);
			FMemory::Memcpy(Dest, Bytes.Data, static_cast<SIZE_T>(W) * H * D3 * 4);
			Mip->BulkData.Unlock();
			PD->Mips.Add(Mip);
			V->SetPlatformData(PD);
			V->SRGB = Flag(J, TEXT("srgb"));
			V->Filter = Flag(J, TEXT("nearest")) ? TF_Nearest : TF_Bilinear;
			V->AddressMode = Num(J, TEXT("wrapS")) == 1001 ? TA_Clamp : TA_Wrap;
			V->UpdateResource();
			Result = V;
		}
	}
	T.Texture = Result;
	T.bFlipY = Flag(J, TEXT("flipY"));
	const TArray<TSharedPtr<FJsonValue>>* Rep = nullptr; const TArray<TSharedPtr<FJsonValue>>* Off = nullptr;
	if (J->TryGetArrayField(TEXT("repeat"), Rep) && J->TryGetArrayField(TEXT("offset"), Off) && Rep->Num() == 2 && Off->Num() == 2)
	{
		T.UVTransform = FVector4f((*Rep)[0]->AsNumber(), (*Rep)[1]->AsNumber(), (*Off)[0]->AsNumber(), (*Off)[1]->AsNumber());
	}
	// Materials that use this texture pick up the new image.
	for (TPair<int32, FJsgbMaterial>& M : Materials) { if (M.Value.Map == Id && M.Value.Instance) { ApplyTextureParams(M.Value.Instance, Id); } }
}

void UJsgbSceneMirror::ApplyTextureParams(UMaterialInstanceDynamic* Mid, int32 TextureId)
{
	const FJsgbTexture* T = Textures.Find(TextureId);
	if (!T || !T->Texture) { Mid->SetScalarParameterValue(TEXT("MapMix"), 0.f); return; }
	Mid->SetTextureParameterValue(TEXT("Map"), T->Texture);
	Mid->SetScalarParameterValue(TEXT("MapMix"), 1.f);
	Mid->SetScalarParameterValue(TEXT("FlipV"), T->bFlipY ? 1.f : 0.f);
	Mid->SetVectorParameterValue(TEXT("UVXform"), FLinearColor(T->UVTransform.X, T->UVTransform.Y, T->UVTransform.Z, T->UVTransform.W));
}

void UJsgbSceneMirror::SetMaterial(int32 Id, const FString& Json)
{
	FJsgbMaterial& M = Materials.FindOrAdd(Id);
	if (M.Json == Json && M.Instance) { return; }
	M.Json = Json;
	TSharedPtr<FJsonObject> J = ParseJson(Json);
	if (!J) { return; }
	const FString Type = Str(J, TEXT("type"));
	const bool bBillboard = Type.StartsWith(TEXT("Points")) || Type.StartsWith(TEXT("Sprite"));
	const bool bUnlit = Flag(J, TEXT("unlit"));
	const bool bTransparent = Flag(J, TEXT("transparent"));
	const int32 Side = static_cast<int32>(Num(J, TEXT("side")));
	const bool bDouble = Side != 0;
	double AlphaTest = Num(J, TEXT("alphaTest"));
	if (Flag(J, TEXT("alphaHash")) && AlphaTest <= 0) { AlphaTest = 0.5; }
	const double Blending = Num(J, TEXT("blending"), 1);
	const TSharedPtr<FJsonObject>* Uniforms = nullptr;
	const bool bUniforms = J->TryGetObjectField(TEXT("uniforms"), Uniforms) && Uniforms && Uniforms->IsValid();
	const int32 Variant = bBillboard ? (Blending == 2 ? VBillboardAdd : VBillboard)
		: bUnlit ? (Blending == 2 ? VAdditive : bTransparent ? VUnlitTrans : AlphaTest > 0 ? VUnlitMasked : VUnlit)
		: (Blending == 2 ? VAdditive : bTransparent ? VTrans : AlphaTest > 0 ? VMasked : bDouble ? VLit2S : VLit);
	// A registry material (by material key or custom shader name) replaces the generic parent.
	const FString RegistryPath = Str(J, TEXT("registryMaterial"));
	UMaterialInterface* Parent = nullptr;
	if (!RegistryPath.IsEmpty())
	{
		TObjectPtr<UObject>& Cached = LoadedAssets.FindOrAdd(RegistryPath);
		if (!Cached) { Cached = LoadObject<UMaterialInterface>(nullptr, *RegistryPath, nullptr, LOAD_NoWarn | LOAD_Quiet); }
		Parent = Cast<UMaterialInterface>(Cached);
	}
	// A game shader translated to HLSL (Runtime/src/shaders.ts) draws with its generated material.
	const FString CustomKey = Str(J, TEXT("custom"));
	const int32 BlendMode = Blending == 2 ? 2 : bTransparent ? 1 : 0;
	// Only DoubleSide draws both faces; BackSide draws back faces through reversed culling (see Show).
	if (!Parent && !CustomKey.IsEmpty()) { Parent = GeneratedParent(CustomKey, BlendMode, Side == 2); }
	M.bCustom = Parent && !CustomKey.IsEmpty();
	const int32 VariantKey = Parent ? 1000 + (GetTypeHash(RegistryPath + CustomKey) + BlendMode * 7 + (Side == 2 ? 1 : 0)) % 100000 : Variant;
	if (!M.Instance || M.Variant != VariantKey)
	{
		M.Instance = UMaterialInstanceDynamic::Create(Parent ? Parent : ParentFor(Variant), this);
		M.Variant = VariantKey;
		ApplySceneParams(M.Instance, VariantKey);
	}
	UMaterialInstanceDynamic* Mid = M.Instance;
	const FLinearColor Color = JsonColor(J, TEXT("color"), FLinearColor::White);
	const FLinearColor Emissive = JsonColor(J, TEXT("emissive"), FLinearColor::Black) * Num(J, TEXT("emissiveIntensity"), 1);
	M.Color = Color;
	M.Opacity = Num(J, TEXT("opacity"), 1);
	M.Size = Num(J, TEXT("size"), 1);
	M.bSizeAttenuation = !J->HasField(TEXT("sizeAttenuation")) || Flag(J, TEXT("sizeAttenuation"));
	M.bVertexColors = Flag(J, TEXT("vertexColors"));
	Mid->SetVectorParameterValue(TEXT("Color"), Color);
	Mid->SetVectorParameterValue(TEXT("Emissive"), Emissive);
	Mid->SetScalarParameterValue(TEXT("Roughness"), Num(J, TEXT("roughness"), 0.8));
	Mid->SetScalarParameterValue(TEXT("Metallic"), Num(J, TEXT("metalness")));
	Mid->SetScalarParameterValue(TEXT("Opacity"), M.Opacity);
	Mid->SetScalarParameterValue(TEXT("AlphaTest"), AlphaTest);
	Mid->SetScalarParameterValue(TEXT("VertexColorMix"), M.bVertexColors ? 1.f : 0.f);
	M.bNoFog = J->HasField(TEXT("fog")) && !Flag(J, TEXT("fog"));
	M.Side = Side;
	Mid->SetScalarParameterValue(TEXT("Fogged"), M.bNoFog ? 0.f : 1.f);
	Mid->SetScalarParameterValue(TEXT("Specular"), Num(J, TEXT("specular"), 0.5));
	if (bUniforms)
	{
		// Uniforms (shader materials and onBeforeCompile hooks) drive same-named parameters without
		// the "u" prefix (uTime -> Time). Unknown names are ignored by the material.
		for (const TPair<FString, TSharedPtr<FJsonValue>>& U : (*Uniforms)->Values)
		{
			const FString Key(*U.Key);
			// Generated materials use the uniform names as they are.
			const FString Name = !M.bCustom && Key.StartsWith(TEXT("u")) && Key.Len() > 1 && FChar::IsUpper(Key[1]) ? Key.RightChop(1) : Key;
			if (U.Value->Type == EJson::Number) { Mid->SetScalarParameterValue(*Name, U.Value->AsNumber()); }
			else if (U.Value->Type == EJson::Object)
			{
				const int32 TexId = static_cast<int32>(Num(U.Value->AsObject(), TEXT("tex")));
				if (const FJsgbTexture* T = Textures.Find(TexId)) { if (T->Texture) { Mid->SetTextureParameterValue(*Name, T->Texture); } }
			}
			else if (U.Value->Type == EJson::Array)
			{
				const TArray<TSharedPtr<FJsonValue>>& A = U.Value->AsArray();
				FLinearColor V(0, 0, 0, 1);
				for (int32 I = 0; I < FMath::Min(4, A.Num()); ++I) { V.Component(I) = A[I]->AsNumber(); }
				Mid->SetVectorParameterValue(*Name, V);
			}
		}
	}
	M.Map = static_cast<int32>(Num(J, TEXT("map")));
	ApplyTextureParams(Mid, M.Map);
}

UMaterialInstanceDynamic* UJsgbSceneMirror::MaterialFor(int32 Id)
{
	FJsgbMaterial* M = Materials.Find(Id);
	return M ? M->Instance.Get() : nullptr;
}

UStaticMeshComponent* UJsgbSceneMirror::NewComponent(bool bInstanced)
{
	AActor* Owner = GetOwner();
	UStaticMeshComponent* C = nullptr;
	if (bInstanced)
	{
		UInstancedStaticMeshComponent* I = NewObject<UInstancedStaticMeshComponent>(Owner);
		I->NumCustomDataFloats = 3;
		C = I;
	}
	else { C = NewObject<UStaticMeshComponent>(Owner); }
	C->SetMobility(EComponentMobility::Movable);
	C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	C->SetGenerateOverlapEvents(false);
	C->bReceivesDecals = false;
	C->SetupAttachment(Owner->GetRootComponent());
	C->RegisterComponent();
	return C;
}

FJsgbEntity& UJsgbSceneMirror::EntityOf(int32 Id, int32 Kind)
{
	FJsgbEntity& Ent = Entities.FindOrAdd(Id);
	Ent.Id = Id;
	if (Ent.Kind != Kind)
	{
		if (Ent.Component) { Ent.Component->DestroyComponent(); Ent.Component = nullptr; }
		if (Ent.Effect) { Ent.Effect->DestroyComponent(); Ent.Effect = nullptr; }
		Ent.Kind = Kind; Ent.GeometryRevision = -1; Ent.Geometry = 0; Ent.Materials.Reset(); Ent.InstanceCount = -1; Ent.LineSignature.Reset();
	}
	return Ent;
}

void UJsgbSceneMirror::ApplyLight(const float* S, uint32 FrameStamp, FLinearColor& Ambient, FLinearColor& HemiSky, FLinearColor& HemiGround)
{
	const int32 Id = static_cast<int32>(S[1]);
	const int32 Kind = static_cast<int32>(S[2]);
	const FLinearColor Color(S[3], S[4], S[5]);
	const float Intensity = S[6] * LightScale;
	if (Kind == 4) { Ambient += Color * Intensity; return; }
	if (Kind == 5) { HemiSky += Color * Intensity; HemiGround += FLinearColor(S[18], S[19], S[20]) * Intensity; return; }
	if (Kind == 6) { return; }
	FJsgbLight& L = Lights.FindOrAdd(Id);
	if (!L.Component || L.Kind != Kind)
	{
		if (L.Component) { L.Component->DestroyComponent(); }
		AActor* Owner = GetOwner();
		ULightComponent* C = nullptr;
		if (Kind == 1) { C = NewObject<UDirectionalLightComponent>(Owner); }
		else if (Kind == 2) { UPointLightComponent* P = NewObject<UPointLightComponent>(Owner); P->IntensityUnits = ELightUnits::Candelas; P->bUseInverseSquaredFalloff = true; C = P; }
		else { USpotLightComponent* P = NewObject<USpotLightComponent>(Owner); P->IntensityUnits = ELightUnits::Candelas; P->bUseInverseSquaredFalloff = true; C = P; }
		C->SetMobility(EComponentMobility::Movable);
		C->SetupAttachment(Owner->GetRootComponent());
		C->RegisterComponent();
		L.Component = C;
		L.Kind = Kind;
	}
	ULightComponent* C = L.Component;
	L.Seen = FrameStamp;
	if (!C->IsVisible()) { C->SetVisibility(true); }
	C->SetLightColor(Color, true);
	C->SetIntensity(Intensity);
	C->SetCastShadows(S[17] > 0.5f);
	const FVector Loc(Pos(&S[7]));
	const FVector Forward(Dir(&S[10]));
	C->SetWorldLocationAndRotation(Loc, Forward.IsNearlyZero() ? FRotator(-90, 0, 0) : Forward.Rotation());
	if (Kind == 2 || Kind == 3)
	{
		ULocalLightComponent* Local = Cast<ULocalLightComponent>(C);
		const float Distance = S[13];
		Local->SetAttenuationRadius(Distance > 0 ? Distance * Cm : 6000.f);
		if (Kind == 3)
		{
			USpotLightComponent* Spot = Cast<USpotLightComponent>(C);
			const float Outer = FMath::RadiansToDegrees(S[15]);
			Spot->SetOuterConeAngle(Outer);
			Spot->SetInnerConeAngle(Outer * (1.f - FMath::Clamp(S[16], 0.f, 1.f)));
		}
	}
}

void UJsgbSceneMirror::SetScene(FName Name, const FLinearColor& V)
{
	// Generated shader materials read the collection; the authored base materials read plain
	// parameters (collections made from Python have no parameter ids), so changes go to each instance.
	if (Globals && GetWorld()) { UKismetMaterialLibrary::SetVectorParameterValue(GetWorld(), Globals, Name, V); }
	if (const FLinearColor* Old = SceneParams.Find(Name)) { if (Old->Equals(V, 1e-6f)) { return; } }
	SceneParams.Add(Name, V);
	const bool bBillboardOnly = Name == TEXT("CamRight") || Name == TEXT("CamUp") || Name == TEXT("ViewParams");
	for (TPair<int32, FJsgbMaterial>& M : Materials)
	{
		if (!M.Value.Instance || M.Value.bCustom || M.Value.Variant >= 1000) { continue; }
		if (bBillboardOnly && M.Value.Variant != VBillboard && M.Value.Variant != VBillboardAdd) { continue; }
		M.Value.Instance->SetVectorParameterValue(Name, V);
	}
	if (PostMid) { PostMid->SetVectorParameterValue(Name, V); }
}

void UJsgbSceneMirror::ApplySceneParams(UMaterialInstanceDynamic* Mid, int32 Variant)
{
	if (Variant >= 1000) { return; }
	for (const TPair<FName, FLinearColor>& P : SceneParams)
	{
		const bool bBillboardOnly = P.Key == TEXT("CamRight") || P.Key == TEXT("CamUp") || P.Key == TEXT("ViewParams");
		if (!bBillboardOnly || Variant == VBillboard || Variant == VBillboardAdd) { Mid->SetVectorParameterValue(P.Key, P.Value); }
	}
}

void UJsgbSceneMirror::ApplyPost(const float* H)
{
	if (!Camera) { return; }
	if (!PostMid && !FParse::Param(FCommandLine::Get(), TEXT("JsgbNoPost")))
	{
		// The fog/background post material, as an instance so the scene values can reach it.
		if (UMaterialInterface* Post = LoadObject<UMaterialInterface>(nullptr, TEXT("/JsGameBridge/Mirror/M_JsgbScenePost.M_JsgbScenePost"), nullptr, LOAD_NoWarn | LOAD_Quiet))
		{
			PostMid = UMaterialInstanceDynamic::Create(Post, this);
			for (const TPair<FName, FLinearColor>& P : SceneParams) { PostMid->SetVectorParameterValue(P.Key, P.Value); }
			Camera->PostProcessSettings.WeightedBlendables.Array.Add(FWeightedBlendable(1.f, PostMid));
		}
	}
	FPostProcessSettings& P = Camera->PostProcessSettings;
	// Three.js exposure multiplies linear colour; Unreal's bias is in stops.
	P.bOverride_AutoExposureBias = true; P.AutoExposureBias = FMath::Log2(FMath::Max(1e-3f, H[35]));
	// UnrealBloomPass strength is close to Unreal's bloom intensity; no pass means no bloom.
	P.bOverride_BloomIntensity = true; P.BloomIntensity = H[37] > 0 ? H[37] : 0.f;
	P.bOverride_BloomThreshold = true; P.BloomThreshold = H[37] > 0 ? H[39] : -1.f;
}

void UJsgbSceneMirror::ApplyFrame(const float* D, int32 Count, const float* Inst, int32 InstCount)
{
	if (Count < HeaderFloats) { return; }
	ParentFor(VLit);
	const double T0 = FPlatformTime::Seconds();
	SkippedEntities = 0; CompilingEntities = 0; SpritesDrawn = 0; PointsDrawn = 0;
	FrameLines.Reset();
	const double StallAtStart = StallMs;
	++Stamp;
	++FrameCounter;

	// Build queued geometry within the budget.
	while (BuildQueue.Num() > 0 && (FPlatformTime::Seconds() - T0) * 1000.0 < BuildBudgetMs)
	{
		const int32 Id = BuildQueue[0];
		BuildQueue.RemoveAt(0, EAllowShrinking::No);
		FJsgbGeometry* G = Geometries.Find(Id);
		if (!G || !G->Pending) { continue; }
		int32 Slots = 1;
		G->Mesh = BuildMesh(*G->Pending, Slots);
		if (!G->Mesh) { ++EmptyBuilds; }
		G->Slots = Slots;
		G->BuiltRevision = G->Revision;
		G->Pending.Reset();
	}

	// Camera.
	const float* E = D;
	CameraLocation = FVector(E[12] * Cm, E[14] * Cm, E[13] * Cm);
	const FVector Forward(-E[8], -E[10], -E[9]);
	const FVector Up(E[4], E[6], E[5]);
	CameraRotation = FRotationMatrix::MakeFromXZ(Forward, Up).Rotator();
	const float VFov = D[16];
	const float ViewAspect = ViewportSize.Y > 0 ? static_cast<float>(ViewportSize.X) / ViewportSize.Y : FMath::Max(0.1f, D[17]);
	CameraHFov = VFov > 0 ? FMath::RadiansToDegrees(2.f * FMath::Atan(FMath::Tan(FMath::DegreesToRadians(VFov) * 0.5f) * ViewAspect)) : 90.f;
	const float TanHalf = VFov > 0 ? FMath::Tan(FMath::DegreesToRadians(VFov) * 0.5f) : 0.5f;
	if (Camera)
	{
		Camera->SetWorldLocationAndRotation(CameraLocation, CameraRotation);
		if (D[20] > 0.5f) { Camera->SetProjectionMode(ECameraProjectionMode::Orthographic); Camera->SetOrthoWidth(D[21] * 2.f * ViewAspect * Cm); Camera->SetOrthoNearClipPlane(D[18] * Cm); Camera->SetOrthoFarClipPlane(D[19] * Cm); }
		else { Camera->SetProjectionMode(ECameraProjectionMode::Perspective); Camera->SetFieldOfView(CameraHFov); }
		ApplyPost(D);
	}

	FLinearColor Ambient(0, 0, 0, 0), HemiSky(0, 0, 0, 0), HemiGround(0, 0, 0, 0);
	int32 K = HeaderFloats;
	int32 Drawn = 0;
	auto SetSlots = [this](FJsgbEntity& Ent, UStaticMeshComponent* C, int32 Slots, const float* Mats, int32 NumMats)
	{
		for (int32 S = 0; S < Slots; ++S)
		{
			const int32 Mat = static_cast<int32>(Mats[FMath::Min(S, NumMats - 1)]);
			if (Ent.Materials.Num() <= S) { Ent.Materials.Add(-1); }
			// Compare the instance too: a material can get a new parent (a generated shader material arriving later).
			UMaterialInstanceDynamic* Mid = MaterialFor(Mat);
			if (Ent.Materials[S] != Mat || (Mid && C->GetMaterial(S) != Mid)) { Ent.Materials[S] = Mat; if (Mid) { C->SetMaterial(S, Mid); } }
		}
	};
	auto Show = [this, &Drawn](FJsgbEntity& Ent, UPrimitiveComponent* C, int32 Flags)
	{
		if (DebugHiddenKinds & (1 << Ent.Kind)) { if (C->IsVisible()) { C->SetVisibility(false); } Ent.Seen = Stamp; return; }
		const bool bShadow = (Flags & 1) != 0;
		if (C->CastShadow != bShadow) { C->SetCastShadow(bShadow); }
		// Surfaces three.js draws without fog mark themselves in the custom stencil for the scene post.
		const FJsgbMaterial* First = Ent.Materials.Num() ? Materials.Find(Ent.Materials[0]) : nullptr;
		const bool bNoFog = First && First->bNoFog;
		if (C->bRenderCustomDepth != bNoFog) { C->SetRenderCustomDepth(bNoFog); C->SetCustomDepthStencilValue(bNoFog ? 1 : 0); }
		if (UStaticMeshComponent* Sm = Cast<UStaticMeshComponent>(C))
		{
			const bool bBack = First && First->Side == 1;
			if (Sm->bReverseCulling != bBack) { Sm->bReverseCulling = bBack; Sm->MarkRenderStateDirty(); }
		}
		if (!C->IsVisible()) { C->SetVisibility(true); }
		Ent.Seen = Stamp;
		++Drawn;
		const bool bCompiling = Ent.Materials.Num() && MaterialCompiling(Ent.Materials[0]);
		if (bCompiling) { ++CompilingEntities; }
		TraceRecord(Ent.Id, bCompiling ? 3 : 1, bCompiling ? TEXT("generated material still compiling") : TEXT(""));
	};
	while (K < Count)
	{
		const int32 Type = static_cast<int32>(D[K]);
		if (Type == RMesh)
		{
			if (K + 5 > Count) { break; }
			const int32 Id = static_cast<int32>(D[K + 1]), Geo = static_cast<int32>(D[K + 2]), Flags = static_cast<int32>(D[K + 3]), NumMats = static_cast<int32>(D[K + 4]);
			if (K + 5 + NumMats + 16 > Count || NumMats < 1) { break; }
			const float* Mats = &D[K + 5];
			const float* M = &D[K + 5 + NumMats];
			K += 5 + NumMats + 16;
			FJsgbGeometry* G = Geometries.Find(Geo);
			if (G && !G->Mesh) { FirstBuild(Geo, G); }
			if (!G || !G->Mesh) { ++SkippedEntities; TraceRecord(Id, 2, G ? TEXT("mesh could not be built") : TEXT("geometry released")); continue; }
			FJsgbEntity& Ent = EntityOf(Id, RMesh);
			if (!Ent.Component) { Ent.Component = NewComponent(false); }
			UStaticMeshComponent* C = CastChecked<UStaticMeshComponent>(Ent.Component);
			if (Ent.Geometry != Geo || Ent.GeometryRevision != G->BuiltRevision) { C->SetStaticMesh(G->Mesh); Ent.Geometry = Geo; Ent.GeometryRevision = G->BuiltRevision; Ent.Materials.Reset(); }
			SetSlots(Ent, C, G->Slots, Mats, NumMats);
			C->SetWorldTransform(ToTransform(M));
			Show(Ent, C, Flags);
		}
		else if (Type == RInstanced)
		{
			if (K + 25 > Count) { break; }
			const int32 Id = static_cast<int32>(D[K + 1]), Geo = static_cast<int32>(D[K + 2]), Mat = static_cast<int32>(D[K + 3]), Flags = static_cast<int32>(D[K + 4]), N = static_cast<int32>(D[K + 5]);
			const float* M = &D[K + 6];
			const bool bChanged = D[K + 22] > 0.5f, bColors = D[K + 23] > 0.5f;
			const int32 Offset = static_cast<int32>(D[K + 24]);
			K += 25;
			// A negative geometry id names a registry mesh (asset key) instead of mirrored geometry.
			UStaticMesh* Mesh = nullptr; int32 Slots = 1, Revision = 0;
			if (Geo < 0)
			{
				TSharedPtr<FJsonObject> A = Asset(-Geo);
				const FString Path = Str(A, TEXT("mesh"));
				TObjectPtr<UObject>& Cached = LoadedAssets.FindOrAdd(Path);
				if (!Cached && !Path.IsEmpty()) { Cached = LoadObject<UStaticMesh>(nullptr, *Path); }
				Mesh = Cast<UStaticMesh>(Cached); Revision = 1;
			}
			else if (FJsgbGeometry* G = Geometries.Find(Geo)) { if (!G->Mesh) { FirstBuild(Geo, G); } Mesh = G->Mesh; Slots = G->Slots; Revision = G->BuiltRevision; }
			if (!Mesh) { ++SkippedEntities; TraceRecord(Id, 2, TEXT("instanced mesh could not be built")); continue; }
			FJsgbEntity& Ent = EntityOf(Id, RInstanced);
			if (!Ent.Component) { Ent.Component = NewComponent(true); }
			UInstancedStaticMeshComponent* C = CastChecked<UInstancedStaticMeshComponent>(Ent.Component);
			const bool bNewMesh = Ent.Geometry != Geo || Ent.GeometryRevision != Revision;
			if (bNewMesh) { C->SetStaticMesh(Mesh); Ent.Geometry = Geo; Ent.GeometryRevision = Revision; Ent.Materials.Reset(); }
			if (Geo >= 0 && (Ent.Materials.Num() == 0 || Ent.Materials[0] != Mat || (MaterialFor(Mat) && C->GetMaterial(0) != MaterialFor(Mat))))
			{
				Ent.Materials.SetNum(1); Ent.Materials[0] = Mat;
				if (UMaterialInstanceDynamic* Mid = MaterialFor(Mat)) { for (int32 S = 0; S < Slots; ++S) { C->SetMaterial(S, Mid); } }
			}
			C->SetWorldTransform(ToTransform(M));
			if ((bChanged || bNewMesh || Ent.InstanceCount < 0) && Offset >= 0 && Offset + N * 16 <= InstCount)
			{
				TArray<FTransform> Ts;
				Ts.SetNumUninitialized(N);
				for (int32 I = 0; I < N; ++I) { Ts[I] = ToTransform(&Inst[Offset + I * 16]); }
				if (C->GetInstanceCount() == N) { C->BatchUpdateInstancesTransforms(0, Ts, false, true, true); }
				else { C->ClearInstances(); C->AddInstances(Ts, false, false, false); }
				if (bColors && Offset + N * 19 <= InstCount)
				{
					const float* Col = &Inst[Offset + N * 16];
					for (int32 I = 0; I < N; ++I) { C->SetCustomData(I, TArray<float>({Col[I * 3], Col[I * 3 + 1], Col[I * 3 + 2]}), false); }
					if (UMaterialInstanceDynamic* Mid = MaterialFor(Mat)) { Mid->SetScalarParameterValue(TEXT("InstanceColorMix"), 1.f); }
				}
				C->MarkRenderStateDirty();
				Ent.InstanceCount = N;
			}
			Show(Ent, C, Flags);
		}
		else if (Type == RLight)
		{
			if (K + 21 > Count) { break; }
			ApplyLight(&D[K], Stamp, Ambient, HemiSky, HemiGround);
			K += 21;
		}
		else if (Type == RSprite || Type == RPoints)
		{
			// Sprites: one camera-facing quad. Points: one quad per point, built with the geometry.
			const bool bSprite = Type == RSprite;
			if (K + (bSprite ? 9 : 21) > Count) { break; }
			const int32 Id = static_cast<int32>(D[K + 1]);
			const int32 Mat = static_cast<int32>(D[K + (bSprite ? 2 : 3)]);
			UStaticMesh* Mesh = nullptr; int32 Revision = 1, Geo = 0, Flags = 0;
			FTransform Xf;
			float SizeX = 1, SizeY = 1, Rotation = 0, Mode = 0;
			const FJsgbMaterial* MatInfo = Materials.Find(Mat);
			if (bSprite)
			{
				Mesh = SpriteQuad();
				Xf = FTransform(FQuat::Identity, FVector(Pos(&D[K + 3])));
				SizeX = D[K + 6]; SizeY = D[K + 7]; Rotation = D[K + 8];
				const bool bAttenuate = !MatInfo || MatInfo->bSizeAttenuation;
				Mode = bAttenuate ? 0.f : 2.f;
				if (bAttenuate) { SizeX *= Cm; SizeY *= Cm; }
				K += 9;
			}
			else
			{
				Geo = static_cast<int32>(D[K + 2]); Flags = static_cast<int32>(D[K + 4]);
				Xf = ToTransform(&D[K + 5]);
				K += 21;
				FJsgbGeometry* G = Geometries.Find(Geo);
				if (G && !G->Mesh) { FirstBuild(Geo, G); }
				if (!G || !G->Mesh) { ++SkippedEntities; TraceRecord(Id, 2, TEXT("point mesh could not be built")); continue; }
				Mesh = G->Mesh; Revision = G->BuiltRevision;
				const float Size = MatInfo ? MatInfo->Size : 1.f;
				// three.js: attenuated points are size * tan(fov/2) world units across; others are pixels.
				if (!MatInfo || MatInfo->bSizeAttenuation) { SizeX = SizeY = Size * TanHalf * Cm; Mode = 0; } else { SizeX = SizeY = Size; Mode = 1; }
			}
			FJsgbEntity& Ent = EntityOf(Id, Type);
			if (!Ent.Component) { Ent.Component = NewComponent(false); CastChecked<UStaticMeshComponent>(Ent.Component)->SetBoundsScale(4.f); }
			UStaticMeshComponent* C = CastChecked<UStaticMeshComponent>(Ent.Component);
			if (Ent.Geometry != Geo || Ent.GeometryRevision != Revision || C->GetStaticMesh() != Mesh) { C->SetStaticMesh(Mesh); Ent.Geometry = Geo; Ent.GeometryRevision = Revision; Ent.Materials.Reset(); }
			const float MatF = static_cast<float>(Mat);
			SetSlots(Ent, C, 1, &MatF, 1);
			C->SetWorldTransform(Xf);
			C->SetCustomPrimitiveDataFloat(0, SizeX);
			C->SetCustomPrimitiveDataFloat(1, SizeY);
			C->SetCustomPrimitiveDataFloat(2, Rotation);
			C->SetCustomPrimitiveDataFloat(3, Mode);
			Show(Ent, C, Flags);
			if (C->IsVisible()) { ++(bSprite ? SpritesDrawn : PointsDrawn); }
		}
		else if (Type == RLines)
		{
			if (K + 21 > Count) { break; }
			const int32 Id = static_cast<int32>(D[K + 1]), Geo = static_cast<int32>(D[K + 2]), Mat = static_cast<int32>(D[K + 3]);
			const float* M = &D[K + 5];
			K += 21;
			FJsgbGeometry* G = Geometries.Find(Geo);
			if (!G || G->LinePoints.Num() == 0) { continue; }
			FJsgbEntity& Ent = EntityOf(Id, RLines);
			const FJsgbMaterial* MatInfo = Materials.Find(Mat);
			const FLinearColor Base = MatInfo ? MatInfo->Color : FLinearColor::White;
			const float Alpha = MatInfo ? MatInfo->Opacity : 1.f;
			// Redraw only when the geometry, material or transform changed.
			FString Sig = FString::Printf(TEXT("%d:%d:%d:%s"), Geo, G->BuiltRevision, Mat, MatInfo ? *MatInfo->Json.Left(64) : TEXT(""));
			for (int32 I = 0; I < 16; ++I) { Sig += FString::Printf(TEXT(",%.4g"), M[I]); }
			if (Sig != Ent.LineSignature)
			{
				Ent.LineSignature = Sig;
				const FMatrix W = ToUE(M);
				Ent.LineCenter = W.GetOrigin();
				TArray<FBatchedLine>& Batch = Ent.Lines;
				Batch.Reset(G->LinePoints.Num() / 2);
				for (int32 I = 0; I + 1 < G->LinePoints.Num(); I += 2)
				{
					const FVector3f& A3 = G->LinePoints[I]; const FVector3f& B3 = G->LinePoints[I + 1];
					const float AP[3] = {A3.X, A3.Y, A3.Z}, BP[3] = {B3.X, B3.Y, B3.Z};
					const FVector A = W.TransformPosition(FVector(AP[0] * Cm, AP[2] * Cm, AP[1] * Cm));
					const FVector B = W.TransformPosition(FVector(BP[0] * Cm, BP[2] * Cm, BP[1] * Cm));
					FLinearColor C = Base * (MatInfo && MatInfo->bVertexColors ? G->LineColors[I] : FLinearColor::White);
					C.A = Alpha;
					Batch.Emplace(A, B, C, 0.f, 0.f, SDPG_World);
				}
			}
			Ent.Seen = Stamp;
			if (!(DebugHiddenKinds & (1 << RLines))) { FrameLines.Add(TPair<double, int32>(FVector::DistSquared(CameraLocation, Ent.LineCenter), Id)); ++Drawn; TraceRecord(Id, 1, TEXT("")); }
		}
		else if (Type == RAsset)
		{
			if (K + 20 > Count) { break; }
			const int32 Id = static_cast<int32>(D[K + 1]), KeyId = static_cast<int32>(D[K + 2]);
			const float* M = &D[K + 4];
			K += 20;
			TSharedPtr<FJsonObject> A = Asset(KeyId);
			const FString Path = Str(A, TEXT("mesh"));
			if (Path.IsEmpty()) { continue; }
			TObjectPtr<UObject>& Cached = LoadedAssets.FindOrAdd(Path);
			if (!Cached) { Cached = LoadObject<UStaticMesh>(nullptr, *Path); }
			UStaticMesh* Mesh = Cast<UStaticMesh>(Cached);
			if (!Mesh) { continue; }
			FJsgbEntity& Ent = EntityOf(Id, RAsset);
			if (!Ent.Component) { Ent.Component = NewComponent(false); }
			UStaticMeshComponent* C = CastChecked<UStaticMeshComponent>(Ent.Component);
			if (C->GetStaticMesh() != Mesh)
			{
				C->SetStaticMesh(Mesh);
				const FString MatPath = Str(A, TEXT("material"));
				if (!MatPath.IsEmpty())
				{
					TObjectPtr<UObject>& MC = LoadedAssets.FindOrAdd(MatPath);
					if (!MC) { MC = LoadObject<UMaterialInterface>(nullptr, *MatPath); }
					if (UMaterialInterface* MI = Cast<UMaterialInterface>(MC)) { for (int32 S = 0; S < C->GetNumMaterials(); ++S) { C->SetMaterial(S, MI); } }
				}
			}
			C->SetWorldTransform(ToTransform(M));
			Show(Ent, C, 1);
		}
		else if (Type == REffect)
		{
			if (K + 19 > Count) { break; }
			const int32 Id = static_cast<int32>(D[K + 1]), KeyId = static_cast<int32>(D[K + 2]);
			const float* M = &D[K + 3];
			K += 19;
			TSharedPtr<FJsonObject> A = Asset(KeyId);
			const FString Path = Str(A, TEXT("niagara"));
			if (Path.IsEmpty()) { continue; }
			FJsgbEntity& Ent = EntityOf(Id, REffect);
			if (!Ent.Effect)
			{
				TObjectPtr<UObject>& Cached = LoadedAssets.FindOrAdd(Path);
				if (!Cached) { Cached = LoadObject<UNiagaraSystem>(nullptr, *Path); }
				if (UNiagaraSystem* System = Cast<UNiagaraSystem>(Cached))
				{
					Ent.Effect = UNiagaraFunctionLibrary::SpawnSystemAttached(System, GetOwner()->GetRootComponent(), NAME_None, FVector::ZeroVector, FRotator::ZeroRotator, EAttachLocation::KeepWorldPosition, false);
				}
			}
			if (Ent.Effect)
			{
				Ent.Effect->SetWorldTransform(ToTransform(M));
				if (!Ent.Effect->IsActive()) { Ent.Effect->Activate(true); }
				Ent.Seen = Stamp;
				++Drawn;
			}
		}
		else
		{
			UE_LOG(LogJsgbMirror, Warning, TEXT("Unknown record %d at %d of %d"), Type, K, Count);
			break;
		}
	}
	DrawnEntities = Drawn;
	// Lines in three.js's transparent order: farthest first, equal distances by object id.
	FrameLines.Sort([](const TPair<double, int32>& A, const TPair<double, int32>& B) { return A.Key != B.Key ? A.Key > B.Key : A.Value < B.Value; });
	{
		// Unreal's translucent lines still depth-test each other, so a line drawn on top of an equal one
		// loses wherever the depths tie. Each later line moves toward the camera along its own view
		// rays by a tiny step: its pixels stay put, and it wins ties as it would in three.js.
		FString Order = FString::Printf(TEXT("%.1f,%.1f,%.1f|"), CameraLocation.X, CameraLocation.Y, CameraLocation.Z);
		for (const TPair<double, int32>& P : FrameLines) { const FJsgbEntity* LineEnt = Entities.Find(P.Value); Order += FString::Printf(TEXT("%d:%u,"), P.Value, LineEnt ? GetTypeHash(LineEnt->LineSignature) : 0u); }
		if (Order != SharedLinesOrder)
		{
			SharedLinesOrder = Order;
			if (!SharedLines)
			{
				SharedLines = NewObject<ULineBatchComponent>(GetOwner());
				SharedLines->SetupAttachment(GetOwner()->GetRootComponent());
				SharedLines->RegisterComponent();
			}
			SharedLines->Flush();
			TArray<FBatchedLine> All;
			int32 Rank = 0;
			for (const TPair<double, int32>& P : FrameLines)
			{
				const FJsgbEntity* LineEnt = Entities.Find(P.Value);
				if (!LineEnt) { continue; }
				const double Step = 2e-5 * ++Rank;
				for (FBatchedLine L : LineEnt->Lines)
				{
					L.Start += (CameraLocation - L.Start) * Step;
					L.End += (CameraLocation - L.End) * Step;
					All.Add(L);
				}
			}
			if (All.Num()) { SharedLines->DrawLines(All); }
			LineSegmentsDrawn = All.Num();
		}
	}
	FrameLines.Reset();
	CheckGenerated();
	if (StallMs - StallAtStart > 50.0) { UE_LOG(LogJsgbMirror, Display, TEXT("Frame %d built new meshes for %.0f ms before drawing; the game clock leaves this out"), FrameCounter, StallMs - StallAtStart); }

	// Hide what the scene no longer contains; destroy what stays gone.
	for (auto It = Entities.CreateIterator(); It; ++It)
	{
		FJsgbEntity& Ent = It.Value();
		if (Ent.Seen == Stamp) { continue; }
		if (bTrace && TraceState.FindRef(Ent.Id) == 1 && Ent.Seen == Stamp - 1) { UE_LOG(LogJsgbMirror, Display, TEXT("TRACE f%d id %d removed: the game stopped drawing it"), FrameCounter, Ent.Id); TraceState.Remove(Ent.Id); }
		if (Stamp - Ent.Seen > 600)
		{
			if (Ent.Component) { Ent.Component->DestroyComponent(); }
			if (Ent.Effect) { Ent.Effect->DestroyComponent(); }
			It.RemoveCurrent();
			continue;
		}
		if (Ent.Component && Ent.Component->IsVisible()) { Ent.Component->SetVisibility(false); }
		if (Ent.Effect && Ent.Effect->IsActive()) { Ent.Effect->Deactivate(); }
	}
	for (auto It = Lights.CreateIterator(); It; ++It)
	{
		FJsgbLight& L = It.Value();
		if (L.Seen == Stamp || !L.Component) { continue; }
		if (Stamp - L.Seen > 600) { L.Component->DestroyComponent(); It.RemoveCurrent(); continue; }
		if (L.Component->IsVisible()) { L.Component->SetVisibility(false); }
	}

	// Ambient, hemisphere, background and fog drive the shared material parameters. Three.js
	// divides ambient irradiance by pi in its Lambert term; the materials add BaseColor * value.
	{
		const float InvPi = 1.f / PI;
		SetScene(TEXT("Ambient"), Ambient * InvPi);
		SetScene(TEXT("HemiSky"), HemiSky * InvPi);
		SetScene(TEXT("HemiGround"), HemiGround * InvPi);
		SetScene(TEXT("Background"), FLinearColor(D[23], D[24], D[25], D[22]));
		SetScene(TEXT("FogColor"), FLinearColor(D[27], D[28], D[29], D[26]));
		SetScene(TEXT("CameraParams"), FLinearColor(D[18] * Cm, D[19] * Cm * 0.999f, 3e6f, 0));
		SetScene(TEXT("FogParams"), FLinearColor(D[30] * Cm, D[31] * Cm, D[32] / Cm, D[26]));
		SetScene(TEXT("ViewParams"), FLinearColor(TanHalf, ViewportSize.Y, ViewportSize.X, 0));
		// The Three.js camera for generated shader materials: view and projection matrix columns
		// (column-major, as GLSL reads them) and the camera position, all in Three.js units.
		for (int32 I = 0; I < 4; ++I)
		{
			SetScene(*FString::Printf(TEXT("ViewCol%d"), I), FLinearColor(D[40 + I * 4], D[41 + I * 4], D[42 + I * 4], D[43 + I * 4]));
			SetScene(*FString::Printf(TEXT("ProjCol%d"), I), FLinearColor(D[56 + I * 4], D[57 + I * 4], D[58 + I * 4], D[59 + I * 4]));
			SetScene(*FString::Printf(TEXT("CamCol%d"), I), FLinearColor(D[I * 4], D[I * 4 + 1], D[I * 4 + 2], D[I * 4 + 3]));
			SetScene(*FString::Printf(TEXT("ProjInvCol%d"), I), FLinearColor(D[72 + I * 4], D[73 + I * 4], D[74 + I * 4], D[75 + I * 4]));
		}
		SetScene(TEXT("CameraPos"), FLinearColor(D[12], D[13], D[14], 1));
		// Billboards (points, sprites) spread along the camera's right and up axes in Unreal space.
		const FRotationMatrix CamAxes(CameraRotation);
		const FVector Right = CamAxes.GetUnitAxis(EAxis::Y), CamUp = CamAxes.GetUnitAxis(EAxis::Z);
		SetScene(TEXT("CamRight"), FLinearColor(Right.X, Right.Y, Right.Z, 0));
		SetScene(TEXT("CamUp"), FLinearColor(CamUp.X, CamUp.Y, CamUp.Z, 0));
	}
}

void UJsgbSceneMirror::ApplyEvents(const FString& Json)
{
	TArray<TSharedPtr<FJsonValue>> Events;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), Events)) { return; }
	for (const TSharedPtr<FJsonValue>& V : Events)
	{
		const TSharedPtr<FJsonObject> E = V->AsObject();
		if (!E) { continue; }
		const FString Kind = Str(E, TEXT("kind"));
		if (Kind == TEXT("key")) { KeyNames.Add(static_cast<int32>(Num(E, TEXT("id"))), Str(E, TEXT("key"))); continue; }
		const TSharedPtr<FJsonObject> A = Registry.FindRef(Str(E, TEXT("key")));
		if (!A) { continue; }
		FTransform T = FTransform::Identity;
		const TArray<TSharedPtr<FJsonValue>>* Matrix = nullptr;
		if (E->TryGetArrayField(TEXT("matrix"), Matrix) && Matrix->Num() == 16)
		{
			float F[16]; for (int32 I = 0; I < 16; ++I) { F[I] = (*Matrix)[I]->AsNumber(); }
			T = ToTransform(F);
		}
		const TSharedPtr<FJsonObject>* Params = nullptr;
		E->TryGetObjectField(TEXT("parameters"), Params);
		if (Kind == TEXT("effect"))
		{
			if (UNiagaraSystem* System = LoadObject<UNiagaraSystem>(nullptr, *Str(A, TEXT("niagara"))))
			{
				if (UNiagaraComponent* C = UNiagaraFunctionLibrary::SpawnSystemAtLocation(GetWorld(), System, T.GetLocation(), T.Rotator(), T.GetScale3D()))
				{
					if (Params) for (const auto& P : (*Params)->Values)
					{
						if (P.Value->Type == EJson::Number) { C->SetVariableFloat(FName(*P.Key), P.Value->AsNumber()); }
						else if (P.Value->Type == EJson::Array && P.Value->AsArray().Num() >= 3) { const auto& Arr = P.Value->AsArray(); C->SetVariableVec3(FName(*P.Key), FVector(Arr[0]->AsNumber(), Arr[2]->AsNumber(), Arr[1]->AsNumber())); }
					}
				}
			}
		}
		else if (Kind == TEXT("sound"))
		{
			if (USoundBase* Sound = LoadObject<USoundBase>(nullptr, *Str(A, TEXT("sound")))) { UGameplayStatics::PlaySoundAtLocation(this, Sound, T.GetLocation(), Num(E, TEXT("volume"), 1), Num(E, TEXT("pitch"), 1)); }
		}
		else if (Kind == TEXT("cameraShake"))
		{
			if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0))
			{
				if (PC->PlayerCameraManager) { if (UClass* Class = LoadClass<UCameraShakeBase>(nullptr, *Str(A, TEXT("cameraShake")))) { PC->PlayerCameraManager->StartCameraShake(Class, Num(E, TEXT("scale"), 1)); } }
			}
		}
	}
}

void UJsgbSceneMirror::SetShader(const FString& Key, const FString& Json)
{
	if (TSharedPtr<FJsonObject> J = ParseJson(Json)) { Shaders.Add(Key, J); UE_LOG(LogJsgbMirror, Display, TEXT("Shader %s translated (%d chars of HLSL)"), *Key, Str(J, TEXT("hlsl")).Len()); }
}

UMaterialInterface* UJsgbSceneMirror::GeneratedParent(const FString& Key, int32 Blend, bool bTwoSided)
{
	const FString CacheKey = FString::Printf(TEXT("%s|%d|%d"), *Key, Blend, bTwoSided ? 1 : 0);
	if (TObjectPtr<UMaterial>* Found = Generated.Find(CacheKey)) { return *Found; }
	UMaterial* Result = nullptr;
#if WITH_EDITOR
	const TSharedPtr<FJsonObject> S = Shaders.FindRef(Key);
	if (S)
	{
		ParentFor(VLit);
		UMaterial* Mat = NewObject<UMaterial>(this, NAME_None, RF_Transient);
		Mat->MaterialDomain = MD_Surface;
		Mat->BlendMode = Blend == 2 ? BLEND_Additive : Blend == 1 ? BLEND_Translucent : BLEND_Opaque;
		Mat->TwoSided = bTwoSided;
		Mat->SetShadingModel(MSM_Unlit);
		Mat->bUsedWithInstancedStaticMeshes = true;
		Mat->bUsedWithNiagaraSprites = false;
		auto Add = [Mat](UMaterialExpression* E) { Mat->GetExpressionCollection().AddExpression(E); return E; };
		// One Custom node per stage; its inputs are the node graph the translated HLSL reads.
		auto MakeCustom = [&](const FString& Code, const TCHAR* InputsField, ECustomMaterialOutputType Output) -> UMaterialExpressionCustom*
		{
		UMaterialExpressionCustom* Custom = NewObject<UMaterialExpressionCustom>(Mat);
		Custom->Code = Code;
		Custom->OutputType = Output;
		Custom->Description = Key;
		Custom->Inputs.Reset();
		const TArray<TSharedPtr<FJsonValue>>* Inputs = nullptr;
		S->TryGetArrayField(InputsField, Inputs);
		for (const TSharedPtr<FJsonValue>& V : Inputs ? *Inputs : TArray<TSharedPtr<FJsonValue>>())
		{
			const TSharedPtr<FJsonObject> In = V->AsObject();
			const FString Source = Str(In, TEXT("source")), Param = Str(In, TEXT("param"));
			const int32 Index = static_cast<int32>(Num(In, TEXT("index")));
			UMaterialExpression* E = nullptr;
			if (Source == TEXT("localPosition")) { E = NewObject<UMaterialExpressionLocalPosition>(Mat); }
			else if (Source == TEXT("worldPosition")) { E = NewObject<UMaterialExpressionWorldPosition>(Mat); }
			else if (Source == TEXT("localAxis"))
			{
				UMaterialExpressionConstant3Vector* Axis = NewObject<UMaterialExpressionConstant3Vector>(Mat);
				Axis->Constant = FLinearColor(Index == 0 ? 1 : 0, Index == 1 ? 1 : 0, Index == 2 ? 1 : 0);
				UMaterialExpressionTransform* T = NewObject<UMaterialExpressionTransform>(Mat);
				T->TransformSourceType = TRANSFORMSOURCE_Local; T->TransformType = TRANSFORM_World;
				T->Input.Connect(0, Add(Axis));
				E = T;
			}
			else if (Source == TEXT("localOrigin"))
			{
				UMaterialExpressionConstant3Vector* Zero = NewObject<UMaterialExpressionConstant3Vector>(Mat);
				Zero->Constant = FLinearColor(0, 0, 0);
				UMaterialExpressionTransformPosition* T = NewObject<UMaterialExpressionTransformPosition>(Mat);
				T->TransformSourceType = TRANSFORMPOSSOURCE_Local; T->TransformType = TRANSFORMPOSSOURCE_World;
				T->Input.Connect(0, Add(Zero));
				E = T;
			}
			else if (Source == TEXT("localNormal"))
			{
				UMaterialExpressionTransform* T = NewObject<UMaterialExpressionTransform>(Mat);
				T->TransformSourceType = TRANSFORMSOURCE_World; T->TransformType = TRANSFORM_Local;
				T->Input.Connect(0, Add(NewObject<UMaterialExpressionVertexNormalWS>(Mat)));
				E = T;
			}
			else if (Source == TEXT("uv")) { UMaterialExpressionTextureCoordinate* T = NewObject<UMaterialExpressionTextureCoordinate>(Mat); T->CoordinateIndex = Index; E = T; }
			else if (Source == TEXT("vertexColor")) { E = NewObject<UMaterialExpressionVertexColor>(Mat); }
			else if (Source == TEXT("primitiveData"))
			{
				UMaterialExpressionVectorParameter* P = NewObject<UMaterialExpressionVectorParameter>(Mat);
				P->ParameterName = *FString::Printf(TEXT("JsgbModel%d"), Index);
				P->bUseCustomPrimitiveData = true; P->PrimitiveDataIndex = Index;
				P->DefaultValue = FLinearColor(Index == 4 ? 1 : 0, Index == 8 ? 1 : 0, Index == 12 ? 1 : 0, Index == 16 ? 1 : 0);
				E = P;
			}
			else if (Source == TEXT("collection"))
			{
				UMaterialExpressionCollectionParameter* P = NewObject<UMaterialExpressionCollectionParameter>(Mat);
				P->Collection = Globals; P->ParameterName = *Param;
				P->ParameterId = Globals ? Globals->GetParameterId(*Param) : FGuid();
				E = P;
			}
			else if (Source == TEXT("scalar")) { UMaterialExpressionScalarParameter* P = NewObject<UMaterialExpressionScalarParameter>(Mat); P->ParameterName = *Param; P->DefaultValue = 0; E = P; }
			else if (Source == TEXT("vector")) { UMaterialExpressionVectorParameter* P = NewObject<UMaterialExpressionVectorParameter>(Mat); P->ParameterName = *Param; P->DefaultValue = FLinearColor(0, 0, 0, 0); E = P; }
			else if (Source == TEXT("texture") || Source == TEXT("cube") || Source == TEXT("volume"))
			{
				UMaterialExpressionTextureObjectParameter* P = NewObject<UMaterialExpressionTextureObjectParameter>(Mat);
				P->ParameterName = *Param;
				P->Texture = Source == TEXT("cube") ? LoadObject<UTexture>(nullptr, TEXT("/Engine/EngineResources/DefaultTextureCube.DefaultTextureCube"))
					: Source == TEXT("volume") ? LoadObject<UTexture>(nullptr, TEXT("/Engine/EngineResources/DefaultVolumeTexture.DefaultVolumeTexture"))
					: LoadObject<UTexture>(nullptr, TEXT("/Engine/EngineResources/WhiteSquareTexture.WhiteSquareTexture"));
				P->SamplerType = SAMPLERTYPE_Color;
				E = P;
			}
			if (!E) { continue; }
			Add(E);
			// Vector parameters put RGBA on output 5; vertex colour has no RGBA output, so append A to RGB.
			int32 Output = Cast<UMaterialExpressionVectorParameter>(E) ? 5 : 0;
			if (Source == TEXT("vertexColor"))
			{
				UMaterialExpressionAppendVector* Rgba = NewObject<UMaterialExpressionAppendVector>(Mat);
				Rgba->A.Connect(0, E); Rgba->B.Connect(4, E);
				E = Add(Rgba); Output = 0;
			}
			FCustomInput CI;
			CI.InputName = *Str(In, TEXT("name"));
			CI.Input.Connect(Output, E);
			Custom->Inputs.Add(CI);
		}
		Add(Custom);
		return Custom;
		};
		UMaterialExpressionCustom* Custom = MakeCustom(Str(S, TEXT("hlsl")), TEXT("inputs"), CMOT_Float4);
		const FString VertexCode = Str(S, TEXT("vertexHlsl"));
		if (!VertexCode.IsEmpty()) { Mat->GetEditorOnlyData()->WorldPositionOffset.Connect(0, MakeCustom(VertexCode, TEXT("vertexInputs"), CMOT_Float3)); }
		UMaterialExpressionComponentMask* Rgb = NewObject<UMaterialExpressionComponentMask>(Mat);
		Rgb->R = Rgb->G = Rgb->B = true; Rgb->A = false; Rgb->Input.Connect(0, Custom); Add(Rgb);
		UMaterialExpressionComponentMask* Alpha = NewObject<UMaterialExpressionComponentMask>(Mat);
		Alpha->A = true; Alpha->R = Alpha->G = Alpha->B = false; Alpha->Input.Connect(0, Custom); Add(Alpha);
		UMaterialEditorOnlyData* Ed = Mat->GetEditorOnlyData();
		if (Blend == 2)
		{
			// Three.js additive blending scales the source by its alpha.
			UMaterialExpressionMultiply* Mul = NewObject<UMaterialExpressionMultiply>(Mat);
			Mul->A.Connect(0, Rgb); Mul->B.Connect(0, Alpha); Add(Mul);
			Ed->EmissiveColor.Connect(0, Mul);
		}
		else { Ed->EmissiveColor.Connect(0, Rgb); }
		if (Blend == 1) { Ed->Opacity.Connect(0, Alpha); }
		Mat->PreEditChange(nullptr);
		Mat->PostEditChange();
		// Finish compiling now, so the first frame that uses it draws the game's shader and not
		// Unreal's default material. The time comes off the game clock (StallMs).
		{
			const double C0 = FPlatformTime::Seconds();
			const ERHIFeatureLevel::Type Level = GetWorld() ? GetWorld()->GetFeatureLevel() : GMaxRHIFeatureLevel;
			if (FMaterialResource* R = Mat->GetMaterialResource(GMaxRHIShaderPlatform)) { R->FinishCompilation(); }
			const double Ms = (FPlatformTime::Seconds() - C0) * 1000.0;
			StallMs += Ms;
			UE_LOG(LogJsgbMirror, Display, TEXT("Generated material %s compiled in %.0f ms before first use"), *Key, Ms);
		}
		GeneratedPending.Add(CacheKey);
		UE_LOG(LogJsgbMirror, Display, TEXT("Generated material for shader %s (%d inputs, blend %d)"), *Key, Custom->Inputs.Num(), Blend);
		Result = Mat;
	}
#endif
	Generated.Add(CacheKey, Result);
	return Result;
}

bool UJsgbSceneMirror::MaterialCompiling(int32 MaterialId) const
{
#if WITH_EDITOR
	const FJsgbMaterial* M = Materials.Find(MaterialId);
	if (!M || !M->bCustom || !M->Instance) { return false; }
	UMaterial* Base = M->Instance->GetMaterial();
	const ERHIFeatureLevel::Type Level = GetWorld() ? GetWorld()->GetFeatureLevel() : GMaxRHIFeatureLevel;
	if (!Base) { return false; }
	const EShaderPlatform Platform = GMaxRHIShaderPlatform;
	const FMaterialResource* R = Base->GetMaterialResource(Platform);
	static TSet<const UMaterial*> Reported;
	if (bTrace && !Reported.Contains(Base))
	{
		Reported.Add(Base);
		FString Q;
		for (int32 I = 0; I < EMaterialQualityLevel::Num; ++I)
		{
			const FMaterialResource* RQ = Base->GetMaterialResource(Platform, static_cast<EMaterialQualityLevel::Type>(I));
			Q += FString::Printf(TEXT(" q%d=%s/%s/%s"), I, RQ ? TEXT("res") : TEXT("none"), RQ && RQ->GetGameThreadShaderMap() ? TEXT("map") : TEXT("nomap"), RQ && RQ->IsGameThreadShaderMapComplete() ? TEXT("complete") : TEXT("incomplete"));
		}
		const FMaterialResource* RF = Base->GetMaterialResource(GShaderPlatformForFeatureLevel[Level]);
		UE_LOG(LogJsgbMirror, Display, TEXT("TRACE material %s platform %d: default=%s%s featurelevel-platform %d=%s/%s"), *Base->GetName(), static_cast<int32>(Platform),
			R ? TEXT("res") : TEXT("none"), *Q, static_cast<int32>(GShaderPlatformForFeatureLevel[Level]), RF ? TEXT("res") : TEXT("none"), RF && RF->GetGameThreadShaderMap() ? TEXT("map") : TEXT("nomap"));
	}
	// Without a resource or a shader map, Unreal draws its default material in place of this one.
	// (On-demand shader maps report "incomplete" while drawing correctly, so that flag is not used.)
	return !R || !R->GetGameThreadShaderMap();
#else
	return false;
#endif
}

void UJsgbSceneMirror::TraceRecord(int32 Id, uint8 State, const TCHAR* Why)
{
	if (!bTrace) { return; }
	const uint8 Old = TraceState.FindRef(Id);
	if (Old == State) { return; }
	const int32 Since = TraceSince.FindRef(Id);
	// Only changes after an object was first drawn are dropouts; a new object waiting for its first build is logged once.
	if (State == 2 && Old == 1) { UE_LOG(LogJsgbMirror, Display, TEXT("TRACE f%d id %d DROPOUT after %d drawn frames: %s"), FrameCounter, Id, FrameCounter - Since, Why); }
	else if (State == 2 && Old == 0) { UE_LOG(LogJsgbMirror, Display, TEXT("TRACE f%d id %d waiting: %s"), FrameCounter, Id, Why); }
	else if (State == 3) { UE_LOG(LogJsgbMirror, Display, TEXT("TRACE f%d id %d drawn untextured: %s"), FrameCounter, Id, Why); }
	else if (State == 1 && Old != 0) { UE_LOG(LogJsgbMirror, Display, TEXT("TRACE f%d id %d drawn again after %d frames %s"), FrameCounter, Id, FrameCounter - Since, Old == 2 ? TEXT("missing") : TEXT("untextured")); }
	TraceState.Add(Id, State);
	TraceSince.Add(Id, FrameCounter);
}

void UJsgbSceneMirror::CheckGenerated()
{
#if WITH_EDITOR
	// Report generated-material compile errors once each material finishes compiling.
	for (int32 I = GeneratedPending.Num() - 1; I >= 0; --I)
	{
		UMaterial* Mat = Generated.FindRef(GeneratedPending[I]);
		const ERHIFeatureLevel::Type Level = GetWorld() ? GetWorld()->GetFeatureLevel() : GMaxRHIFeatureLevel;
		FMaterialResource* R = Mat ? Mat->GetMaterialResource(GMaxRHIShaderPlatform) : nullptr;
		if (R && !R->IsCompilationFinished()) { continue; }
		if (R) { for (const FString& E : R->GetCompileErrors()) { UE_LOG(LogJsgbMirror, Error, TEXT("Generated material %s: %s"), *GeneratedPending[I], *E.Left(600)); } }
		GeneratedPending.RemoveAt(I);
	}
#endif
}

void UJsgbSceneMirror::SetModelData(FJsgbEntity& Ent, UPrimitiveComponent* C, const float* M, const float* Mats, int32 NumMats)
{
	// Generated shader materials read the Three.js model matrix from custom primitive data 4-19.
	bool bCustom = false;
	for (int32 I = 0; I < NumMats && !bCustom; ++I) { const FJsgbMaterial* Mat = Materials.Find(static_cast<int32>(Mats[I])); bCustom = Mat && Mat->bCustom; }
	if (!bCustom || FMemory::Memcmp(Ent.Model, M, sizeof(Ent.Model)) == 0) { return; }
	FMemory::Memcpy(Ent.Model, M, sizeof(Ent.Model));
	for (int32 I = 0; I < 4; ++I) { C->SetCustomPrimitiveDataVector4(4 + I * 4, FVector4(M[I * 4], M[I * 4 + 1], M[I * 4 + 2], M[I * 4 + 3])); }
}

FString UJsgbSceneMirror::Describe(int32 Kind) const
{
	// Debugging aid behind /bridge/describe: what the mirror holds for one record kind (0 = all).
	// A body of "hide:<bitmask>" hides whole record kinds (1 << kind) regardless of the game.
	FString Out = FString::Printf(TEXT("{\"entities\":%d,\"geometries\":%d,\"materials\":%d,\"textures\":%d,\"items\":["), Entities.Num(), Geometries.Num(), Materials.Num(), Textures.Num());
	int32 Listed = 0;
	for (const TPair<int32, FJsgbEntity>& E : Entities)
	{
		if ((Kind && E.Value.Kind != Kind) || Listed >= 40) { continue; }
		const UPrimitiveComponent* C = E.Value.Component;
		const UStaticMeshComponent* S = Cast<UStaticMeshComponent>(C);
		FString Cpd;
		if (C) { for (const float V : C->GetCustomPrimitiveData().Data) { Cpd += FString::Printf(TEXT("%s%.3g"), Cpd.IsEmpty() ? TEXT("") : TEXT(","), V); } }
		Out += FString::Printf(TEXT("%s{\"id\":%d,\"kind\":%d,\"visible\":%d,\"loc\":\"%s\",\"scale\":\"%s\",\"mesh\":\"%s\",\"meshBounds\":\"%s\",\"material\":\"%s\",\"parent\":\"%s\",\"cpd\":[%s]}"),
			Listed ? TEXT(",") : TEXT(""), E.Key, E.Value.Kind, C && C->IsVisible() ? 1 : 0, C ? *C->GetComponentLocation().ToString() : TEXT(""), C ? *C->GetComponentScale().ToString() : TEXT(""),
			S && S->GetStaticMesh() ? *S->GetStaticMesh()->GetName() : TEXT(""), S && S->GetStaticMesh() ? *S->GetStaticMesh()->GetBounds().BoxExtent.ToString() : TEXT(""),
			C && C->GetMaterial(0) ? *C->GetMaterial(0)->GetName() : TEXT(""), C && C->GetMaterial(0) && C->GetMaterial(0)->GetMaterial() ? *C->GetMaterial(0)->GetMaterial()->GetName() : TEXT(""), *Cpd);
		++Listed;
	}
	return Out + TEXT("]}");
}

UStaticMesh* UJsgbSceneMirror::FirstBuild(int32 GeometryId, FJsgbGeometry* G)
{
	if (!G || G->Mesh || !G->Pending) { return G ? G->Mesh.Get() : nullptr; }
	const double T0 = FPlatformTime::Seconds();
	int32 Slots = 1;
	G->Mesh = BuildMesh(*G->Pending, Slots);
	if (!G->Mesh) { ++EmptyBuilds; }
	G->Slots = Slots;
	G->BuiltRevision = G->Revision;
	G->Pending.Reset();
	BuildQueue.Remove(GeometryId);
	StallMs += (FPlatformTime::Seconds() - T0) * 1000.0;
	return G->Mesh;
}

void UJsgbSceneMirror::ResetAll()
{
	StallMs = 0;
	if (SharedLines) { SharedLines->Flush(); }
	SharedLinesOrder.Reset();
	for (TPair<int32, FJsgbEntity>& E : Entities) { if (E.Value.Component) { E.Value.Component->DestroyComponent(); } if (E.Value.Effect) { E.Value.Effect->DestroyComponent(); } }
	for (TPair<int32, FJsgbLight>& L : Lights) { if (L.Value.Component) { L.Value.Component->DestroyComponent(); } }
	Entities.Reset(); Lights.Reset(); Geometries.Reset(); Materials.Reset(); Textures.Reset(); BuildQueue.Reset(); KeyNames.Reset();
}
