# Gera um vídeo de teste (fala sintetizada + vídeo animado + "explosões") para validar o pipeline
$ErrorActionPreference = "Stop"
$dir = Join-Path $PSScriptRoot "..\data\test"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$pt = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like "pt*" } | Select-Object -First 1
if ($pt) { $s.SelectVoice($pt.VoiceInfo.Name) }
$s.Rate = 1
$s.SetOutputToWaveFile((Join-Path $dir "speech.wav"))
$text = @"
Galera, olha isso aqui no GTA 6. A polícia de Vice City é completamente insana.
Eu estava andando de carro com a Lucia e do nada começou uma perseguição absurda.
Ninguém percebeu esse detalhe no trailer, mas a física dos carros mudou totalmente.
Se você reparar no fundo, tem um easter egg escondido perto de Leonida.
E aqui vem a melhor parte. O Jason simplesmente pulou do prédio e caiu dentro do carro.
Isso é muito engraçado, eu não acredito que a Rockstar colocou isso no jogo.
Agora vamos para o assalto. O mapa é gigante, dá pra ir de Vice City até as Keys sem tela de carregamento.
Comenta aí qual foi o melhor momento, e se inscreve no canal para mais cortes de GTA 6.
"@
$s.Speak($text)
$s.Dispose()
Write-Host "speech.wav ok"
