# Image-only Windows OCR helper. This never captures windows or sends input.
# Windows PowerShell 5.1 is used only as the .NET Framework WinRT projection
# runtime: System.Runtime.WindowsRuntime is unavailable in PowerShell 7's .NET.
# Run only with a supplied PNG via bounded UTF-8 JSON stdin.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$output = @{ ok = $false; labels = @(); message = 'Windows 文字识别暂不可用，继续依据有效截图观察。' }
$stream = $null; $writer = $null; $software = $null
function Emit { [Console]::Write(($output | ConvertTo-Json -Depth 8 -Compress)) }
try {
    $inputStream = [Console]::OpenStandardInput()
    $requestStream = [IO.MemoryStream]::new()
    try {
        $buffer = [byte[]]::new(8192)
        while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            if ($requestStream.Length + $read -gt 33554432) { $output.message = 'OCR 请求超过32 MiB，已跳过文字辅助。'; Emit; exit }
            $requestStream.Write($buffer, 0, $read)
        }
        $raw = [Text.UTF8Encoding]::new($false, $true).GetString($requestStream.ToArray())
    } finally { $requestStream.Dispose() }
    $request = $raw | ConvertFrom-Json
    if ($request.mimeType -ne 'image/png' -or $request.imageBase64 -isnot [string] -or !$request.imageBase64.Length) {
        $output.message = 'OCR 只接受传入的 PNG 图片，已跳过文字辅助。'; Emit; exit
    }
    $bytes = [Convert]::FromBase64String($request.imageBase64)
    if ($bytes.Length -lt 33 -or $bytes.Length -gt 25165824 -or [BitConverter]::ToString($bytes, 0, 8) -ne '89-50-4E-47-0D-0A-1A-0A' -or [Text.Encoding]::ASCII.GetString($bytes, 12, 4) -ne 'IHDR') {
        $output.message = 'OCR 图片不是有效 PNG 或超过大小上限，已跳过文字辅助。'; Emit; exit
    }
    $width = [double]$bytes[16] * 16777216 + [double]$bytes[17] * 65536 + [double]$bytes[18] * 256 + $bytes[19]
    $height = [double]$bytes[20] * 16777216 + [double]$bytes[21] * 65536 + [double]$bytes[22] * 256 + $bytes[23]
    if ($width -lt 1 -or $height -lt 1 -or $width -gt 8192 -or $height -gt 8192 -or $width * $height -gt 16777216) {
        $output.message = 'OCR 图片尺寸过大或无效，已跳过文字辅助。'; Emit; exit
    }
    function Is-Integer($value) {
        ($value -is [int] -or $value -is [long] -or $value -is [double] -or $value -is [decimal]) -and
            ![double]::IsNaN([double]$value) -and ![double]::IsInfinity([double]$value) -and [Math]::Floor([double]$value) -eq $value
    }
    $scale = 1
    if ($null -ne $request.scale) {
        if (!(Is-Integer $request.scale) -or $request.scale -notin @(1, 2, 3, 4)) {
            $output.message = 'OCR 放大倍数只支持1至4的整数，已跳过文字辅助。'; Emit; exit
        }
        $scale = [int]$request.scale
    }
    $preprocess = 'none'
    if ($null -ne $request.preprocess) {
        if ($request.preprocess -isnot [string] -or $request.preprocess -cnotin @('none', 'grayscale-invert', 'text-mask')) {
            $output.message = 'OCR 图片预处理方式无效，已跳过文字辅助。'; Emit; exit
        }
        $preprocess = $request.preprocess
    }
    $roiX = 0; $roiY = 0; $roiWidth = $width; $roiHeight = $height
    if ($null -ne $request.region) {
        $r = $request.region
        $keys = @($r.PSObject.Properties.Name | Sort-Object)
        if (($keys -join ',') -ne 'height,width,x,y' -or !(Is-Integer $r.x) -or !(Is-Integer $r.y) -or !(Is-Integer $r.width) -or !(Is-Integer $r.height) -or
            $r.x -lt 0 -or $r.y -lt 0 -or $r.width -le 0 -or $r.height -le 0 -or $r.x + $r.width -gt $width -or $r.y + $r.height -gt $height) {
            $output.message = 'OCR 裁切区域必须是原图内完整的整数像素矩形，已跳过文字辅助。'; Emit; exit
        }
        $roiX = [int]$r.x; $roiY = [int]$r.y; $roiWidth = [int]$r.width; $roiHeight = [int]$r.height
    }
    $ocrWidth = [int]($roiWidth * $scale); $ocrHeight = [int]($roiHeight * $scale)
    if ($ocrWidth -gt 8192 -or $ocrHeight -gt 8192 -or [double]$ocrWidth * $ocrHeight -gt 16777216) {
        $output.message = 'OCR 裁切放大后的图片尺寸超过上限，已跳过文字辅助。'; Emit; exit
    }
    if ($PSVersionTable.PSEdition -ne 'Desktop') {
        $output.message = 'Windows OCR 需要 Windows PowerShell 5.1 的 .NET Framework WinRT 运行时；本次跳过文字辅助。'; Emit; exit
    }
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
    $null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
    $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
    if ($ocrWidth -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension -or $ocrHeight -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension) {
        $output.message = '图片超过 Windows OCR 的最大尺寸，已跳过文字辅助。'; Emit; exit
    }
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('zh-Hans-CN'))
    if ($null -eq $engine) {
        $output.message = 'Windows 简体中文 OCR 语言组件不可用，已跳过文字辅助；仍可依据有效截图观察。'; Emit; exit
    }
    if ($null -ne $request.region -or $scale -ne 1 -or $preprocess -ne 'none') {
        # Image-only crop and enlargement, entirely in memory. Source dimensions
        # remain unchanged below so OCR boxes map back into the original image.
        Add-Type -AssemblyName System.Drawing
        $sourceStream = [IO.MemoryStream]::new($bytes, $false)
        $sourceImage = $null; $ocrImage = $null; $graphics = $null; $encoded = $null; $attributes = $null
        try {
            $sourceImage = [Drawing.Image]::FromStream($sourceStream, $true, $true)
            if ($sourceImage.Width -ne $width -or $sourceImage.Height -ne $height) { throw 'source-dimensions' }
            $ocrImage = [Drawing.Bitmap]::new($ocrWidth, $ocrHeight, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
            $graphics = [Drawing.Graphics]::FromImage($ocrImage)
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $destination = [Drawing.Rectangle]::new(0, 0, $ocrWidth, $ocrHeight)
            if ($preprocess -eq 'none') {
                $graphics.DrawImage($sourceImage, $destination, $roiX, $roiY, $roiWidth, $roiHeight, [Drawing.GraphicsUnit]::Pixel)
            } else {
                # Inverted luminance gives light-on-dark game glyphs a light
                # paper background. Optional threshold is generic, not a list
                # of expected game titles or vocabulary substitutions.
                $matrix = [Drawing.Imaging.ColorMatrix]::new()
                $matrix.Matrix00 = -0.299; $matrix.Matrix01 = -0.299; $matrix.Matrix02 = -0.299
                $matrix.Matrix10 = -0.587; $matrix.Matrix11 = -0.587; $matrix.Matrix12 = -0.587
                $matrix.Matrix20 = -0.114; $matrix.Matrix21 = -0.114; $matrix.Matrix22 = -0.114
                $matrix.Matrix40 = 1; $matrix.Matrix41 = 1; $matrix.Matrix42 = 1
                $matrix.Matrix33 = 1; $matrix.Matrix44 = 1
                $attributes = [Drawing.Imaging.ImageAttributes]::new()
                $attributes.SetColorMatrix($matrix)
                if ($preprocess -eq 'text-mask') { $attributes.SetThreshold([single]0.5) }
                $graphics.DrawImage($sourceImage, $destination, $roiX, $roiY, $roiWidth, $roiHeight, [Drawing.GraphicsUnit]::Pixel, $attributes)
            }
            $encoded = [IO.MemoryStream]::new()
            $ocrImage.Save($encoded, [Drawing.Imaging.ImageFormat]::Png)
            $bytes = $encoded.ToArray()
        } finally {
            if ($encoded) { $encoded.Dispose() }
            if ($graphics) { $graphics.Dispose() }
            if ($attributes) { $attributes.Dispose() }
            if ($ocrImage) { $ocrImage.Dispose() }
            if ($sourceImage) { $sourceImage.Dispose() }
            $sourceStream.Dispose()
        }
    }
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    function Await-WinRT($operation, [Type]$resultType) {
        $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
        $task.GetAwaiter().GetResult()
    }
    $stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
    $writer = [Windows.Storage.Streams.DataWriter]::new($stream)
    $writer.WriteBytes($bytes)
    $null = Await-WinRT ($writer.StoreAsync()) ([uint32])
    $stream.Seek(0)
    $decoder = Await-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    if ($decoder.PixelWidth -ne $ocrWidth -or $decoder.PixelHeight -ne $ocrHeight) { throw 'image-dimensions' }
    $software = Await-WinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $recognized = Await-WinRT ($engine.RecognizeAsync($software)) ([Windows.Media.Ocr.OcrResult])
    $labels = [Collections.Generic.List[object]]::new()
    foreach ($line in ($recognized.Lines | Select-Object -First 1000)) {
        $text = [regex]::Replace($line.Text, '(?<=[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])\s+(?=[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])', '')
        $text = [regex]::Replace($text, '[\x00-\x1f\x7f]', '').Trim()
        if (!$text.Length -or $text.Length -gt 50) { continue }
        $boxes = @($line.Words | ForEach-Object { $_.BoundingRect })
        if (!$boxes.Count) { continue }
        $left = ($boxes.X | Measure-Object -Minimum).Minimum
        $top = ($boxes.Y | Measure-Object -Minimum).Minimum
        $right = ($boxes | ForEach-Object { $_.X + $_.Width } | Measure-Object -Maximum).Maximum
        $bottom = ($boxes | ForEach-Object { $_.Y + $_.Height } | Measure-Object -Maximum).Maximum
        $left = [Math]::Max(0, [Math]::Min($ocrWidth, $left)); $right = [Math]::Max($left, [Math]::Min($ocrWidth, $right))
        $top = [Math]::Max(0, [Math]::Min($ocrHeight, $top)); $bottom = [Math]::Max($top, [Math]::Min($ocrHeight, $bottom))
        if ($right -le $left -or $bottom -le $top) { continue }
        $left = $roiX + $left / $scale; $right = $roiX + $right / $scale
        $top = $roiY + $top / $scale; $bottom = $roiY + $bottom / $scale
        $labels.Add(@{ text = $text; x = [Math]::Round($left * 1000 / $width, 2); y = [Math]::Round($top * 1000 / $height, 2);
            width = [Math]::Round(($right - $left) * 1000 / $width, 2); height = [Math]::Round(($bottom - $top) * 1000 / $height, 2);
            centerX = [Math]::Round(($left + $right) * 500 / $width, 2); centerY = [Math]::Round(($top + $bottom) * 500 / $height, 2) })
    }
    $output.ok = $true
    $output.labels = @($labels | Sort-Object @{Expression={$_.text.Length}}, @{Expression={$_.y}}, @{Expression={$_.x}} | Select-Object -First 120)
    $output.message = if ($output.labels.Count) { '已从传入图片提取界面文字；OCR 可能有误，仍需核对截图。' } else { '传入图片未识别到短界面文字，继续依据有效截图观察。' }
} catch {
    $output.ok = $false; $output.labels = @()
    $output.message = 'Windows OCR 未能处理这张图片，已跳过文字辅助；请核对中文语言组件和图片格式。'
} finally {
    if ($software) { $software.Dispose() }
    if ($writer) { try { $null = $writer.DetachStream() } catch {}; $writer.Dispose() }
    if ($stream) { $stream.Dispose() }
}
Emit
