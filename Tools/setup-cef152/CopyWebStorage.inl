// Inserted into the WebBrowserCef copy of WebBrowserSingleton.cpp by Tools/setup-cef152.ps1. This is the bridge's own code.
#if WITH_CEF3
// JsGameBridge: page games keep their saves in localStorage (and IndexedDB), which live in the CEF profile folder, and
// each CEF build gets its own folder (webcache_<Chromium build>). The first time this CEF starts, copy them from the
// newest older profile (CEF 128's webcache_6613), so players keep their progress after a host update. The older
// folder is left as it is, so going back to the older host still works.
static void JsgbCopyWebStorageFromOlderCef(const FString& CachePathBase, const FString& CachePath)
{
	IPlatformFile& PF = IPlatformFile::GetPlatformPhysical();
	const FString Marker = FPaths::Combine(CachePath, TEXT("jsgb-storage-copied.txt"));
	if (PF.FileExists(*Marker))
	{
		return;
	}
	const FString Root = FPaths::GetPath(CachePathBase);
	const FString Prefix = FPaths::GetCleanFilename(CachePathBase) + TEXT("_");
	const int32 Current = CHROME_VERSION_BUILD;
	int32 Best = 0;
	FString BestDir;
	PF.IterateDirectory(*Root, [&](const TCHAR* Path, bool bIsDirectory)
	{
		const FString Leaf = FPaths::GetCleanFilename(Path);
		const FString Num = Leaf.RightChop(Prefix.Len());
		// webcache_6613 only: webcache_6613_1 and up are extra profiles for copies that ran at the same time
		if (bIsDirectory && Leaf.StartsWith(Prefix) && !Num.IsEmpty() && Num.IsNumeric())
		{
			const int32 Build = FCString::Atoi(*Num);
			if (Build < Current && Build > Best && PF.DirectoryExists(*FPaths::Combine(Path, TEXT("Default"), TEXT("Local Storage"))))
			{
				Best = Build;
				BestDir = Path;
			}
		}
		return true;
	});
	int32 Files = 0;
	if (Best)
	{
		for (const TCHAR* Sub : { TEXT("Local Storage"), TEXT("IndexedDB") })
		{
			const FString From = FPaths::Combine(BestDir, TEXT("Default"), Sub);
			const FString To = FPaths::Combine(CachePath, TEXT("Default"), Sub);
			if (!PF.DirectoryExists(*From))
			{
				continue;
			}
			PF.DeleteDirectoryRecursively(*To);
			PF.CreateDirectoryTree(*To);
			PF.IterateDirectoryRecursively(*From, [&](const TCHAR* Path, bool bIsDirectory)
			{
				const FString Dest = To + FString(Path).RightChop(From.Len());
				if (bIsDirectory)
				{
					PF.CreateDirectoryTree(*Dest);
				}
				else if (FPaths::GetCleanFilename(Path) != TEXT("LOCK"))
				{
					PF.CreateDirectoryTree(*FPaths::GetPath(Dest));
					Files += PF.CopyFile(*Dest, Path) ? 1 : 0;
				}
				return true;
			});
		}
		UE_LOGF(LogWebBrowser, Display, "Copied %d saved-data files from %ls into %ls", Files, *BestDir, *CachePath);
	}
	PF.CreateDirectoryTree(*CachePath);
	FFileHelper::SaveStringToFile(Best ? FString::Printf(TEXT("copied from webcache_%d"), Best) : FString(TEXT("nothing to copy")), *Marker);
}
#endif
