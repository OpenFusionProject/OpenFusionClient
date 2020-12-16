PUSHD %~dp0
.\UnityWebPlayer.exe /quiet /S
robocopy WebPlayer "%USERPROFILE%\AppData\LocalLow\Unity\WebPlayer" /s /e
del "%USERPROFILE%\AppData\LocalLow\Unity\WebPlayer\UnityBugReporter.exe"
POPD