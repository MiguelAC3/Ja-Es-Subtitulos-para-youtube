@echo off
rem Descarga la ultima version de JapanRefactor desde GitHub y la instala en
rem esta misma carpeta. Al ser la misma carpeta, se conservan las palabras
rem guardadas. Va incluido en el ZIP de cada version publicada.
setlocal
set "DEST=%~dp0"
echo Descargando la ultima version de JapanRefactor...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$zip = Join-Path $env:TEMP 'JapanRefactor.zip';" ^
  "Invoke-WebRequest 'https://github.com/MiguelAC3/Ja-Es-Subtitulos-para-youtube/releases/latest/download/JapanRefactor.zip' -OutFile $zip;" ^
  "Expand-Archive $zip -DestinationPath $env:DEST -Force;" ^
  "Remove-Item $zip"
if errorlevel 1 (
  echo.
  echo No se pudo actualizar. Revisa tu conexion e intentalo de nuevo.
) else (
  echo.
  echo Listo. Ahora abre la pagina de extensiones del navegador, pulsa el boton
  echo de recargar de JapanRefactor y recarga las pestanas de YouTube.
)
pause
