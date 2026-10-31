# Built-in Windows OCR. Images stay in memory; capture only the selected HWND.
# Windows PowerShell 5.1 is required for its .NET Framework WinRT bridge.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$output = @{ version = 1; observations = @() }
function Emit { [Console]::Write(($output | ConvertTo-Json -Depth 12 -Compress)) }
try {
    $raw = [Console]::In.ReadToEnd()
    if ($raw.Length -gt 8192) { throw 'request' }
    $request = $raw | ConvertFrom-Json
    if ($request.regions.Count -ne 2 -or (($request.regions.region | Sort-Object -Unique) -join ',') -ne 'comment,gift') { throw 'request' }
    foreach ($region in $request.regions) {
        $r = $region.roi
        if ($null -eq $r -or $r.x -lt 0 -or $r.y -lt 0 -or $r.width -lt .01 -or $r.height -lt .01 -or $r.x + $r.width -gt 1.000001 -or $r.y + $r.height -gt 1.000001) { throw 'request' }
    }
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
    $null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
    $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('zh-Hans-CN'))
    if ($null -eq $engine) { $output.error = 'ocr-language'; Emit; exit }
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
    function Await-WinRT($operation, [Type]$resultType) {
        $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
        $task.GetAwaiter().GetResult()
    }
    if (!$request.warmup) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class FishWindowCapture {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder text, int size);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
        $handle = [IntPtr]::new([long]$request.windowId)
        if (![FishWindowCapture]::IsWindow($handle) -or [FishWindowCapture]::IsIconic($handle)) { $output.error = 'window-missing'; Emit; exit }
        $title = [Text.StringBuilder]::new(512)
        $null = [FishWindowCapture]::GetWindowText($handle, $title, 512)
        [uint32]$ownerId = 0
        $null = [FishWindowCapture]::GetWindowThreadProcessId($handle, [ref]$ownerId)
        $owner = Get-Process -Id $ownerId
        # Validate the selected window again at capture time; handle reuse cannot
        # redirect capture to arbitrary windows. No desktop or audio fallback.
        if ($title.ToString() -notmatch '^(?:抖音)?直播(?:伴侣|助手)(?:\s.*)?$' -or $owner.ProcessName -notmatch '(?i)douyin|直播伴侣|直播助手|webcast') { $output.error = 'window-denied'; Emit; exit }
        $oldDpi = [FishWindowCapture]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
        try {
            $rect = [FishWindowCapture+Rect]::new()
            if (![FishWindowCapture]::GetWindowRect($handle, [ref]$rect)) { throw 'capture' }
            $width = $rect.Right - $rect.Left; $height = $rect.Bottom - $rect.Top
            if ($width -lt 100 -or $height -lt 100 -or $width -gt 8192 -or $height -gt 8192 -or $width * $height -gt 33554432) { throw 'size' }
            # GDI PrintWindow does not populate alpha; RGB avoids false blanks.
            $image = [Drawing.Bitmap]::new($width, $height, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
            $graphics = [Drawing.Graphics]::FromImage($image)
            $dc = $graphics.GetHdc()
            try { $captured = [FishWindowCapture]::PrintWindow($handle, $dc, 2) } finally { $graphics.ReleaseHdc($dc); $graphics.Dispose() }
            if (!$captured) { $image.Dispose(); $output.error = 'capture-failed'; Emit; exit }
        } finally { $null = [FishWindowCapture]::SetThreadDpiAwarenessContext($oldDpi) }
    } else {
        $image = [Drawing.Bitmap]::new(640, 160)
        $graphics = [Drawing.Graphics]::FromImage($image)
        $font = [Drawing.Font]::new('Microsoft YaHei', 28)
        $graphics.Clear([Drawing.Color]::White)
        $graphics.DrawString('本机文字识别准备', $font, [Drawing.Brushes]::Black, 10, 40)
        $font.Dispose(); $graphics.Dispose()
    }
    try {
        $observations = [Collections.Generic.List[object]]::new()
        $images = [Collections.Generic.List[object]]::new()
        $blankCount = 0
        $regions = if ($request.warmup) { @(@{ region='comment'; roi=@{x=0;y=0;width=1;height=1} }) } else { $request.regions }
        foreach ($region in $regions) {
            $r = $region.roi
            $x = [int][Math]::Floor($r.x * $image.Width); $y = [int][Math]::Floor($r.y * $image.Height)
            $w = [Math]::Min($image.Width-$x, [int][Math]::Ceiling($r.width*$image.Width)); $h = [Math]::Min($image.Height-$y, [int][Math]::Ceiling($r.height*$image.Height))
            $crop = $image.Clone([Drawing.Rectangle]::new($x,$y,$w,$h), [Drawing.Imaging.PixelFormat]::Format32bppArgb)
            try {
                $white=0; $black=0; $transparent=0; $samples=0
                for ($sy=0; $sy -lt $h; $sy += [Math]::Max(1,[int]($h/40))) {
                    for ($sx=0; $sx -lt $w; $sx += [Math]::Max(1,[int]($w/40))) {
                        $pixel=$crop.GetPixel($sx,$sy); $samples++
                        if ($pixel.A -lt 5) { $transparent++ } elseif ($pixel.R -gt 250 -and $pixel.G -gt 250 -and $pixel.B -gt 250) { $white++ } elseif ($pixel.R -lt 5 -and $pixel.G -lt 5 -and $pixel.B -lt 5) { $black++ }
                    }
                }
                $blank = [Math]::Max($transparent,[Math]::Max($white,$black)) -ge $samples*.995
                if ($blank) { $blankCount++ }
                if ($request.preview) {
                    $jpeg=[IO.MemoryStream]::new()
                    try { $crop.Save($jpeg,[Drawing.Imaging.ImageFormat]::Jpeg); if ($jpeg.Length -le 1000000) { $images.Add(@{region=$region.region;roi=$r;dataUrl='data:image/jpeg;base64,'+[Convert]::ToBase64String($jpeg.ToArray())}) } } finally { $jpeg.Dispose() }
                    continue
                }
                if ($blank) { continue }
                $png=[IO.MemoryStream]::new()
                $scale = if ([Math]::Max($w,$h)*2 -le [Windows.Media.Ocr.OcrEngine]::MaxImageDimension) { 2 } else { 1 }
                $ocrImage = [Drawing.Bitmap]::new($w*$scale,$h*$scale,[Drawing.Imaging.PixelFormat]::Format24bppRgb)
                $ocrGraphics = [Drawing.Graphics]::FromImage($ocrImage)
                try { $ocrGraphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $ocrGraphics.DrawImage($crop,0,0,$w*$scale,$h*$scale) } finally { $ocrGraphics.Dispose() }
                $randomStream=[Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
                $writer=[Windows.Storage.Streams.DataWriter]::new($randomStream)
                $software=$null
                try {
                    $ocrImage.Save($png,[Drawing.Imaging.ImageFormat]::Png)
                    $writer.WriteBytes($png.ToArray())
                    $null=Await-WinRT ($writer.StoreAsync()) ([uint32]); $randomStream.Seek(0)
                    $decoder=Await-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($randomStream)) ([Windows.Graphics.Imaging.BitmapDecoder])
                    $software=Await-WinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
                    $result=Await-WinRT ($engine.RecognizeAsync($software)) ([Windows.Media.Ocr.OcrResult])
                    foreach ($line in ($result.Lines | Select-Object -First 100)) {
                        $boxes=@($line.Words | ForEach-Object { $_.BoundingRect })
                        if (!$boxes.Count) { continue }
                        $left=($boxes.X | Measure-Object -Minimum).Minimum; $top=($boxes.Y | Measure-Object -Minimum).Minimum
                        $right=($boxes | ForEach-Object { $_.X+$_.Width } | Measure-Object -Maximum).Maximum
                        $bottom=($boxes | ForEach-Object { $_.Y+$_.Height } | Measure-Object -Maximum).Maximum
                        # WinRT supplies no confidence score. Use a conservative
                        # fixed parser weight, then require consecutive frames.
                        $text = [regex]::Replace($line.Text, '(?<=\p{IsCJKUnifiedIdeographs})\s+(?=\p{IsCJKUnifiedIdeographs})', '')
                        $observations.Add(@{text=$text;region=$region.region;confidence=.5;bounds=@{x=($x+$left/$scale)/$image.Width;y=($y+$top/$scale)/$image.Height;width=($right-$left)/$scale/$image.Width;height=($bottom-$top)/$scale/$image.Height}})
                    }
                } finally { if ($software) { $software.Dispose() }; $null=$writer.DetachStream(); $writer.Dispose(); $randomStream.Dispose(); $png.Dispose(); $ocrImage.Dispose() }
            } finally { $crop.Dispose() }
        }
        if (!$request.warmup) { $output.observations=$observations.ToArray(); if ($request.preview) { $output.images=$images.ToArray() }; if ($blankCount -eq 2) { $output.error='blank-frame' } }
    } finally { $image.Dispose() }
} catch { $output.error = 'capture-failed' }
Emit
