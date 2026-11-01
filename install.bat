@echo off
chcp 65001 >nul
setlocal

set "DIR=%~dp0"
set "EXTENSION_ID=oghpkkcfomnabdlcjpcgpknjekghlbgn"
set "HOST_JSON=%DIR%local-server\com.deepseek.web_bridge.json"
set "HOST_JS=%DIR%local-server\native-host.js"

echo {> "%HOST_JSON%"
echo   "name": "com.deepseek.web_bridge",>> "%HOST_JSON%"
echo   "description": "DeepSeek Local OpenAI Bridge Native Messaging Host",>> "%HOST_JSON%"
echo   "path": "%HOST_JS:\=\\%",>> "%HOST_JSON%"
echo   "type": "stdio",>> "%HOST_JSON%"
echo   "allowed_origins": [>> "%HOST_JSON%"
echo     "chrome-extension://%EXTENSION_ID%/">> "%HOST_JSON%"
echo   ]>> "%HOST_JSON%"
echo }>> "%HOST_JSON%"

REG ADD "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.deepseek.web_bridge" /ve /t REG_SZ /d "%HOST_JSON%" /f >nul 2>&1

echo ========================================================
echo 🎉 安装成功！DeepSeek 本地网关已成功注册到 Chrome。
echo ========================================================
echo.
echo 现在您可以直接在 Chrome 工具栏点击插件图标，一键启动代理网关！
pause
