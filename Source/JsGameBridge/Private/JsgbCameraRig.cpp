#include "JsgbCameraRig.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
	TSharedPtr<FJsonObject> Parse(const FString& Json)
	{
		TSharedPtr<FJsonObject> O;
		FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), O);
		return O;
	}
	double Wrap(double A) { return FMath::Atan2(FMath::Sin(A), FMath::Cos(A)); }
}

FString FJsgbCameraRig::Take()
{
	FScopeLock L(&Lock);
	if (!bActive || !bHaveState) { return FString(); }
	++Version;
	Sent.Add(Version, Now);
	return FString::Printf(TEXT("{\"v\":%d,\"target\":[%.9g,%.9g,%.9g],\"theta\":%.12g,\"phi\":%.12g,\"radius\":%.9g}"),
		Version, Now.Target.X, Now.Target.Y, Now.Target.Z, Now.Theta, Now.Phi, Now.Radius);
}

bool FJsgbCameraRig::Give(int32 InVersion, const FString& Json, FState& OutBase, int64& OutInputSeq)
{
	const TSharedPtr<FJsonObject> O = Parse(Json);
	const TArray<TSharedPtr<FJsonValue>>* T = nullptr;
	if (!O || !O->TryGetArrayField(TEXT("target"), T) || T->Num() < 3) { return false; }
	FState S;
	S.Target = FVector((*T)[0]->AsNumber(), (*T)[1]->AsNumber(), (*T)[2]->AsNumber());
	S.Theta = O->GetNumberField(TEXT("theta"));
	S.Phi = O->GetNumberField(TEXT("phi"));
	S.Radius = O->GetNumberField(TEXT("radius"));
	const TArray<TSharedPtr<FJsonValue>>* Axes = nullptr;
	if (O->TryGetArrayField(TEXT("axes"), Axes) && Axes->Num() == 6)
	{
		const FVector Back((*Axes)[0]->AsNumber(), (*Axes)[2]->AsNumber(), (*Axes)[1]->AsNumber());
		const FVector Up((*Axes)[3]->AsNumber(), (*Axes)[5]->AsNumber(), (*Axes)[4]->AsNumber());
		const double SinPhi = FMath::Sin(S.Phi);
		const FVector Look(-SinPhi * FMath::Sin(S.Theta), -SinPhi * FMath::Cos(S.Theta), -FMath::Cos(S.Phi));
		const FQuat OrbitRotation = FRotationMatrix::MakeFromXZ(Look, FVector::UpVector).ToQuat();
		S.RotationOffset = OrbitRotation.Inverse() * FRotationMatrix::MakeFromXZ(-Back, Up).ToQuat();
	}
	FScopeLock L(&Lock);
	bActive = true;
	bInput = !O->HasField(TEXT("input")) || O->GetBoolField(TEXT("input"));
	// The game draws with another camera now (a map, a close-up, a bridge view): the host leaves the view to the game.
	S.bDrive = !O->HasField(TEXT("drive")) || O->GetBoolField(TEXT("drive"));
	const TSharedPtr<FJsonObject>* Limit = nullptr;
	bLimit = O->TryGetObjectField(TEXT("limit"), Limit) && Limit && Limit->IsValid();
	if (bLimit) { LimitX = (*Limit)->GetNumberField(TEXT("x")); LimitZ = (*Limit)->GetNumberField(TEXT("z")); LimitRadius = (*Limit)->GetNumberField(TEXT("radius")); }
	const FState* Sent0 = Sent.Find(InVersion);
	if (!bHaveState || !Sent0) { Now = S; bHaveState = true; }
	else
	{
		// The game's own changes during its frame, on top of the input the host applied meanwhile.
		Now.Target += S.Target - Sent0->Target;
		Now.Theta += Wrap(S.Theta - Sent0->Theta);
		Now.Phi += S.Phi - Sent0->Phi;
		Now.Radius += S.Radius - Sent0->Radius;
		Now.RotationOffset = S.RotationOffset;
		Now.bDrive = S.bDrive;
	}
	for (auto It = Sent.CreateIterator(); It; ++It) { if (It.Key() <= InVersion) { It.RemoveCurrent(); } }
	OutBase = Now;
	OutInputSeq = InputSeq;
	return true;
}

void FJsgbCameraRig::Configure(const FString& Json)
{
	const TSharedPtr<FJsonObject> O = Parse(Json);
	if (!O) { return; }
	FScopeLock L(&Lock);
	Bindings.Reset();
	const TSharedPtr<FJsonObject>* Keys = nullptr;
	if (O->TryGetObjectField(TEXT("keys"), Keys) && Keys && Keys->IsValid())
	{
		for (const auto& Pair : (*Keys)->Values)
		{
			TArray<FString>& Codes = Bindings.Add(FString(*Pair.Key));
			if (Pair.Value->Type == EJson::Array) { for (const TSharedPtr<FJsonValue>& V : Pair.Value->AsArray()) { Codes.Add(V->AsString()); } }
			else if (Pair.Value->Type == EJson::String) { Codes.Add(Pair.Value->AsString()); }
		}
	}
	O->TryGetNumberField(TEXT("pan"), Pan);
	O->TryGetNumberField(TEXT("orbit"), Orbit);
	O->TryGetNumberField(TEXT("zoomKey"), ZoomKey);
	O->TryGetNumberField(TEXT("minPolar"), MinPolar);
	O->TryGetNumberField(TEXT("maxPolar"), MaxPolar);
	O->TryGetNumberField(TEXT("minRadius"), MinRadius);
	O->TryGetNumberField(TEXT("maxRadius"), MaxRadius);
}

void FJsgbCameraRig::Reset()
{
	FScopeLock L(&Lock);
	bActive = false; bHaveState = false; bHaveBase = false; Sent.Reset(); Held.Reset(); Tapped.Reset(); InputLog.Reset();
}

void FJsgbCameraRig::SnapshotBase(const FState& InBase, int64 InInputSeq)
{
	FScopeLock L(&Lock);
	// The glide starts where the camera is drawn now, so nothing jumps; a camera the host wasn't drawing (another view
	// was on screen) or a cut (the game moved the view further than a few orbit radii) starts at the new camera.
	const bool bCut = !bHaveBase || !Base.bDrive || !bDrawn || FVector::Dist(LastBaseDrawn.Target, InBase.Target) > 4.0 * FMath::Max(InBase.Radius, LastBaseDrawn.Radius);
	GlideFrom = bCut ? InBase : LastBaseDrawn;
	if (bCut) { LastBaseDrawn = InBase; }
	Base = InBase;
	BaseSeq = InInputSeq;
	bHaveBase = true;
	InputLog.RemoveAll([InInputSeq](const TPair<int64, FState>& E) { return E.Key <= InInputSeq; });
}

void FJsgbCameraRig::Key(const FString& Code, bool bDown)
{
	FScopeLock L(&Lock);
	if (!bActive) { return; }
	if (bDown) { Held.Add(Code); Tapped.Add(Code); } else { Held.Remove(Code); }
}

void FJsgbCameraRig::ReleaseKeys()
{
	FScopeLock L(&Lock);
	Held.Reset(); Tapped.Reset();
}

void FJsgbCameraRig::Clamp(FState& S) const
{
	S.Phi = FMath::Clamp(S.Phi, MinPolar, MaxPolar);
	S.Radius = FMath::Clamp(S.Radius, MinRadius, MaxRadius);
	if (bLimit)
	{
		const double Dx = S.Target.X - LimitX, Dz = S.Target.Z - LimitZ, D = FMath::Sqrt(Dx * Dx + Dz * Dz);
		if (D > LimitRadius && D > 0) { S.Target.X = LimitX + Dx / D * LimitRadius; S.Target.Z = LimitZ + Dz / D * LimitRadius; }
	}
}

bool FJsgbCameraRig::Tick(float DeltaSeconds, float Alpha, FVector& OutLocation, FRotator& OutRotation, bool& bMoved)
{
	FScopeLock L(&Lock);
	bMoved = false;
	if (!bActive || !bHaveState || !bHaveBase || !Base.bDrive) { Tapped.Reset(); bDrawn = false; return false; }
	bDrawn = true;
	auto On = [this](const TCHAR* Action)
	{
		const TArray<FString>* Codes = Bindings.Find(Action);
		if (!Codes) { return false; }
		for (const FString& C : *Codes) { if (Held.Contains(C) || Tapped.Contains(C)) { return true; } }
		return false;
	};
	if (bInput)
	{
		// The game's own key handling, as three.js units: pan a share of the orbit radius per second along the ground,
		// orbit radians per second, zoom by the pan step times ZoomKey.
		const double Dt = FMath::Min(DeltaSeconds, 0.1f);
		const double Step = Now.Radius * Pan * Dt;
		const FVector Forward(-FMath::Sin(Now.Theta), 0, -FMath::Cos(Now.Theta)), Right(FMath::Cos(Now.Theta), 0, -FMath::Sin(Now.Theta));
		const FState Before = Now;
		if (On(TEXT("forward"))) { Now.Target += Forward * Step; }
		if (On(TEXT("back"))) { Now.Target -= Forward * Step; }
		if (On(TEXT("left"))) { Now.Target -= Right * Step; }
		if (On(TEXT("right"))) { Now.Target += Right * Step; }
		if (On(TEXT("orbitLeft"))) { Now.Theta += Dt * Orbit; }
		if (On(TEXT("orbitRight"))) { Now.Theta -= Dt * Orbit; }
		if (On(TEXT("zoomIn"))) { Now.Radius -= Step * ZoomKey; }
		if (On(TEXT("zoomOut"))) { Now.Radius += Step * ZoomKey; }
		if (!Now.Target.Equals(Before.Target, 0) || Now.Theta != Before.Theta || Now.Radius != Before.Radius) { Clamp(Now); }
		bMoved = !Now.Target.Equals(Before.Target, 0) || Now.Theta != Before.Theta || Now.Radius != Before.Radius;
		if (bMoved)
		{
			FState D;
			D.Target = Now.Target - Before.Target; D.Theta = Now.Theta - Before.Theta; D.Phi = Now.Phi - Before.Phi; D.Radius = Now.Radius - Before.Radius;
			InputLog.Add(TPair<int64, FState>(++InputSeq, D));
		}
	}
	Tapped.Reset();
	// Drawn: the game's camera at the objects' point of its glide, plus the input the game hasn't had yet.
	const double A = FMath::Clamp(Alpha, 0.f, 1.f);
	FState S;
	S.Target = FMath::Lerp(GlideFrom.Target, Base.Target, A);
	S.Theta = GlideFrom.Theta + Wrap(Base.Theta - GlideFrom.Theta) * A;
	S.Phi = FMath::Lerp(GlideFrom.Phi, Base.Phi, A);
	S.Radius = FMath::Lerp(GlideFrom.Radius, Base.Radius, A);
	S.RotationOffset = FQuat::Slerp(GlideFrom.RotationOffset, Base.RotationOffset, A);
	LastBaseDrawn = S;
	for (const TPair<int64, FState>& E : InputLog)
	{
		if (E.Key <= BaseSeq) { continue; }
		S.Target += E.Value.Target; S.Theta += E.Value.Theta; S.Phi += E.Value.Phi; S.Radius += E.Value.Radius;
	}
	// Limits constrain native input, not poses authored by the game.
	// Three.js: the camera sits on the sphere around the target (Spherical: x = r sin(phi) sin(theta), y = r cos(phi),
	// z = r sin(phi) cos(theta)) and looks at it. Unreal: x, z, y in centimetres.
	const double SinPhi = FMath::Sin(S.Phi);
	const FVector Offset(S.Radius * SinPhi * FMath::Sin(S.Theta), S.Radius * FMath::Cos(S.Phi), S.Radius * SinPhi * FMath::Cos(S.Theta));
	const FVector Pos = S.Target + Offset;
	OutLocation = FVector(Pos.X, Pos.Z, Pos.Y) * 100.0;
	const FVector Look = -Offset;
	OutRotation = (FRotationMatrix::MakeFromXZ(FVector(Look.X, Look.Z, Look.Y), FVector(0, 0, 1)).ToQuat() * S.RotationOffset).Rotator();
	return true;
}
