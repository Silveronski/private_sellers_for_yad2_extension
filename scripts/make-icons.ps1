# Builds the extension icons from one large square image.
#
#   Usage (from the project folder):  powershell -File scripts\make-icons.ps1
#   Input:   icon-original.png  (square, any size, e.g. 1024x1024)
#   Output:  icons\icon16.png, icon32.png, icon48.png, icon128.png
#
# Steps
#   1. Make the dark background outside the rounded square transparent.
#      (Image generators usually fill the corners with black instead of
#      leaving them transparent.) Starting from each corner, every connected
#      dark pixel is cleared. Dark areas inside the icon aren't touched because
#      they aren't connected to a corner.
#   2. Resize to each size with high-quality smoothing.
#      16/32/48 fill the whole canvas (toolbar, menus).
#      128 follows Chrome's guideline: 96x96 artwork with 16px transparent
#      padding on each side (extensions page, Web Store).

param(
  [string]$Source = "icon-original.png",
  [string]$OutDir = "icons",
  [int]$DarkThreshold = 120  # 0-255; pixels darker than this (brightest channel) count as background
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

# Flood fill in C# for speed (a 1024px image has ~1M pixels; PowerShell loops are too slow).
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class IconTools {
  public static Bitmap ClearDarkCorners(Bitmap src, int threshold) {
    int w = src.Width, h = src.Height;
    var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
    using (var g = Graphics.FromImage(bmp)) g.DrawImage(src, 0, 0, w, h);

    var rect = new Rectangle(0, 0, w, h);
    var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
    var px = new int[w * h];
    Marshal.Copy(data.Scan0, px, 0, px.Length);

    // Colour used for cleared pixels: fully transparent, but orange, so that
    // smoothing at the edge blends towards orange instead of a dark fringe.
    int edgeColor = Color.FromArgb(0, 255, 80, 0).ToArgb();

    var cleared = new bool[w * h];
    var queue = new Queue<int>();
    foreach (int start in new[] { 0, w - 1, (h - 1) * w, h * w - 1 }) queue.Enqueue(start);

    while (queue.Count > 0) {
      int i = queue.Dequeue();
      if (cleared[i]) continue;
      int c = px[i];
      int bright = Math.Max((c >> 16) & 255, Math.Max((c >> 8) & 255, c & 255));
      if (bright >= threshold) continue;

      cleared[i] = true;
      px[i] = edgeColor;
      int x = i % w, y = i / w;
      if (x > 0)     queue.Enqueue(i - 1);
      if (x < w - 1) queue.Enqueue(i + 1);
      if (y > 0)     queue.Enqueue(i - w);
      if (y < h - 1) queue.Enqueue(i + w);
    }

    Marshal.Copy(px, 0, data.Scan0, px.Length);
    bmp.UnlockBits(data);
    return bmp;
  }
}
"@

function Save-Icon($image, [int]$size, [int]$padding, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $inner = $size - 2 * $padding
  $g.DrawImage($image, $padding, $padding, $inner, $inner)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

$sourcePath = (Resolve-Path $Source).Path
$original = New-Object System.Drawing.Bitmap $sourcePath
if ($original.Width -ne $original.Height) { throw "Source image must be square (got $($original.Width)x$($original.Height))." }

$clean = [IconTools]::ClearDarkCorners($original, $DarkThreshold)
$original.Dispose()

New-Item -ItemType Directory -Force $OutDir | Out-Null
$outPath = (Resolve-Path $OutDir).Path

# size -> transparent padding on each side
$sizes = [ordered]@{ 16 = 0; 32 = 0; 48 = 0; 128 = 16 }
foreach ($size in $sizes.Keys) {
  Save-Icon $clean $size $sizes[$size] (Join-Path $outPath "icon$size.png")
  Write-Host "icons\icon$size.png"
}
$clean.Dispose()
