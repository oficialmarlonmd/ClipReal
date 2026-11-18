# Inicia o painel ClipsReal
Set-Location $PSScriptRoot
Start-Process "http://localhost:8000"
.\.venv\Scripts\python.exe -m clipsreal serve
