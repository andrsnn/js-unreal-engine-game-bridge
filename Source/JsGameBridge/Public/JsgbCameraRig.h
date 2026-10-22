#pragma once

#include "CoreMinimal.h"

/** A game's orbit camera driven by the host (window.jsgb.camera.rig). The game declares its rig (key bindings, pan, orbit
 *  and zoom speeds, limits); each Unreal frame the host moves the camera with the keys held now, so a key moves the view
 *  on the next drawn frame instead of after a game frame, a snapshot and a glide. Each game frame starts by taking the
 *  host's camera (Take) and ends by giving back what the game made of it (Give): the game's own changes in that frame
 *  (glides, following a ship, wheel zoom, drag orbit, keeping content in view) are added to the host's camera, which
 *  has the input since the frame started.
 *
 *  What is drawn: the game's camera glides with the objects (the same snapshot timing, so a followed ship stays still on
 *  screen), plus the key input the game has not seen yet, applied at once. Three.js coordinates throughout: a target
 *  point and spherical angles. */
struct JSGAMEBRIDGE_API FJsgbCameraRig
{
	struct FState
	{
		FVector Target = FVector::ZeroVector;
		double Theta = 0, Phi = 1, Radius = 10;
		// The game's rotation relative to the orbit (shake, roll), in Unreal camera axes.
		FQuat RotationOffset = FQuat::Identity;
		bool bDrive = true;
	};

	/** JavaScript thread: the camera the game adopts at the start of its frame ("" until the game gave one). */
	FString Take();
	/** JavaScript thread: the game's camera after its frame, for the camera Take handed it as Version. Returns false for
	 *  a bad message; otherwise OutBase is the camera with this frame's game changes and OutInputSeq the last input in it,
	 *  for SnapshotBase when this frame's snapshot is drawn. */
	bool Give(int32 Version, const FString& Json, FState& OutBase, int64& OutInputSeq);
	/** JavaScript thread: bindings and speeds ({"keys":{"forward":["KeyW"],...},"pan":0.35,"orbit":0.7,...}). */
	void Configure(const FString& Json);
	/** JavaScript thread: the game switched its rig off. */
	void Reset();

	/** Game thread, with the snapshot of the frame Give came from: the drawn camera glides from where it is to Base. */
	void SnapshotBase(const FState& Base, int64 InputSeq);
	/** Game thread: a key went down or up (a DOM code such as "KeyW"). */
	void Key(const FString& Code, bool bDown);
	/** Game thread: all keys up (the window lost focus). */
	void ReleaseKeys();
	/** Game thread: moves the camera by the keys held for DeltaSeconds and gives the pose to draw in Unreal units, with
	 *  the game's camera at Alpha of its glide (the objects' alpha). False while the game has no rig, hasn't given a
	 *  camera yet or draws with another camera. bMoved says whether keys moved it this frame. */
	bool Tick(float DeltaSeconds, float Alpha, FVector& OutLocation, FRotator& OutRotation, bool& bMoved);

	bool IsActive() const { return bActive; }

private:
	void Clamp(FState& S) const;
	FCriticalSection Lock;
	bool bActive = false, bHaveState = false, bInput = false, bHaveBase = false, bDrawn = false;
	FState Now;
	TMap<int32, FState> Sent;
	int32 Version = 0;
	// Input applied by the host, in order, and how far each moved the camera (differences of FState fields).
	int64 InputSeq = 0;
	TArray<TPair<int64, FState>> InputLog;
	// The game's camera as drawn: gliding from GlideFrom to Base; BaseSeq is the last input Base already has.
	FState GlideFrom, Base, LastBaseDrawn;
	int64 BaseSeq = 0;
	// Action ("forward", "back", "left", "right", "orbitLeft", "orbitRight", "zoomIn", "zoomOut") -> DOM codes.
	TMap<FString, TArray<FString>> Bindings;
	double Pan = 0.35, Orbit = 0.7, ZoomKey = 4.0, MinPolar = 0.01, MaxPolar = PI - 0.01, MinRadius = 0.01, MaxRadius = 1e7;
	bool bLimit = false;
	double LimitX = 0, LimitZ = 0, LimitRadius = 0;
	TSet<FString> Held, Tapped;
};
