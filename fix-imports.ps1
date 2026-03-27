$files = @(
    "e:\dlmm-bot\meridian\memory\lessons.js",
    "e:\dlmm-bot\meridian\memory\pool-memory.js",
    "e:\dlmm-bot\meridian\memory\smart-wallets.js",
    "e:\dlmm-bot\meridian\memory\strategy-library.js",
    "e:\dlmm-bot\meridian\memory\token-blacklist.js",
    "e:\dlmm-bot\meridian\lib\briefing.js",
    "e:\dlmm-bot\meridian\lib\state.js"
)
foreach ($f in $files) {
    $content = Get-Content $f -Raw
    # Fix JSON data file references
    $content = $content.Replace('"./lessons.json"',          '"../data/lessons.json"')
    $content = $content.Replace('"./pool-memory.json"',      '"../data/pool-memory.json"')
    $content = $content.Replace('"./strategy-library.json"', '"../data/strategy-library.json"')
    $content = $content.Replace('"./token-blacklist.json"',  '"../data/token-blacklist.json"')
    $content = $content.Replace('"./state.json"',            '"../data/state.json"')
    Set-Content $f $content -NoNewline
}

# Also fix hive-mind.js
$hmPath = "e:\dlmm-bot\meridian\memory\hive-mind.js"
$hm = Get-Content $hmPath -Raw
$hm = $hm.Replace('"./logger.js"', '"../lib/logger.js"')
$hm = $hm.Replace('"./config.js"', '"../core/config.js"')
Set-Content $hmPath $hm -NoNewline

Write-Host "Data file paths fixed!"
