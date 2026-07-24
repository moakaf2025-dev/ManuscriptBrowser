# -*- coding: utf-8 -*-
# ============================================================
#  إنشاء اختصار سطح المكتب لبرنامج متصفح المخطوطات
#  Create Desktop Shortcut for ManuscriptBrowser
# ============================================================

# فرض ترميز UTF-8 لعرض النصوص العربية بشكل صحيح
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

$appDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$exePath = Join-Path $appDir 'ManuscriptBrowser.exe'
$iconDir = Join-Path $appDir 'resources\app.asar.unpacked'
$iconPath = Join-Path $iconDir 'icon.ico'

Write-Host ''
Write-Host '  =========================================================='
Write-Host '   متصفح المخطوطات - إنشاء اختصار على سطح المكتب'
Write-Host '   ManuscriptBrowser - Create Desktop Shortcut'
Write-Host '  =========================================================='
Write-Host ''

if (-not (Test-Path $exePath)) {
    Write-Host ''
    Write-Host '  [خطأ] لم يتم العثور على ملف البرنامج:' -ForegroundColor Red
    Write-Host "        $exePath"
    Write-Host ''
    Write-Host '  ضع هذا الملف في نفس المجلد الذي يحوي ManuscriptBrowser.exe'
    Write-Host ''
    exit 1
}

if (-not (Test-Path $iconPath)) {
    Write-Host '  [تنبيه] لم يتم العثور على ملف الأيقونة، سيتم استخدام أيقونة الملف التنفيذي.' -ForegroundColor Yellow
    $iconPath = $exePath
}

$desktop  = [Environment]::GetFolderPath('Desktop')
$shortcut = Join-Path $desktop 'متصفح المخطوطات.lnk'

# إذا كان الاختصار موجوداً بالفعل، احذفه لتحديث الأيقونة والمسار
if (Test-Path $shortcut) {
    try { Remove-Item -Force $shortcut } catch {}
}

try {
    $shell = New-Object -ComObject WScript.Shell
    $lnk   = $shell.CreateShortcut($shortcut)
    $lnk.TargetPath       = $exePath
    $lnk.WorkingDirectory = $appDir
    $lnk.IconLocation     = "$iconPath,0"
    $lnk.Description      = 'متصفح المخطوطات - أداة لتصفح ودراسة المخطوطات'
    $lnk.WindowStyle      = 1
    $lnk.Save()
} catch {
    Write-Host ''
    Write-Host '  [خطأ] تعذّر إنشاء الاختصار:' -ForegroundColor Red
    Write-Host "        $($_.Exception.Message)"
    Write-Host ''
    exit 2
}

if (Test-Path $shortcut) {
    Write-Host ''
    Write-Host '  ✔ تم إنشاء الاختصار على سطح المكتب بنجاح' -ForegroundColor Green
    Write-Host "     $shortcut"
    Write-Host ''
    Write-Host '  إذا لم تظهر الأيقونة الصحيحة على الاختصار مباشرة،'
    Write-Host '  فسيتم تحديثها بعد إعادة تشغيل مستكشف الملفات أو الجهاز.'
    Write-Host ''

    # محاولة تنظيف ذاكرة الأيقونات (Icon Cache) لتحديث الأيقونة فوراً
    try {
        $iconCache = Join-Path $env:LOCALAPPDATA 'IconCache.db'
        if (Test-Path $iconCache) {
            attrib -h $iconCache 2>$null
        }
        Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
        Start-Process explorer.exe
    } catch {}
} else {
    Write-Host ''
    Write-Host '  ✘ لم يتم إنشاء الاختصار.' -ForegroundColor Red
    Write-Host ''
    exit 3
}
