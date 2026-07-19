# متصفح المخطوطات — PRD

## المشكلة الأصلية
أداة سطح مكتب متخصصة لباحثي المخطوطات: عرض صور/PDF/أرشيفات، مسطرة أفقية، تقسيم الصفحات المزدوجة، ترقيم الأوراق (أ/ب)، بطاقة معلومات، تعليقات حرّة كفقاعات، عناوين، تصدير Word/PDF/ZIP.

## البنية
- Frontend: React (CRA) → Windows Portable via Electron 33.
- Backend: FastAPI — `/api/download/windows`.
- PDF: pdfjs-dist + pdf-lib. الأرشيفات: libarchive.js (WASM).
- تخزين: localStorage معزول بـNS للوحات جنباً إلى جنب.

## المكوّنات
- `/app/frontend/src/App.js` — SplitView entry.
- `/app/frontend/src/components/SplitView.jsx` — لوحتان جنباً إلى جنب (1 أو 2).
- `/app/frontend/src/components/ManuscriptRuler.jsx` — القلب (~3700 سطر).
- `/app/frontend/src/components/manuscriptDoc.js` — parsing/splitting/exports.
- `/app/desktop/main.js` — Electron entry.
- `/app/backend/server.py` — download endpoint.

## v1.6.0 (19 يوليو 2026) — التصحيحات والإضافات

### تصحيحات جذرية
- **خط الطي**: أعيدت هندسة `createSplittingDoc` لتقبل `overridesRef` قابلاً للتحديث بلا إعادة إنشاء الوثيقة. الشريط اليدوي يعمل فوراً لكل ورقة، مع زر «استعادة التلقائي». مدى الشريط 10-90% بخطوة 0.5%.
- **RGB negatives**: أضفت `state.invertR/G/B/sharpen/denoise` إلى deps الـuseEffect لـrenderPage، فيُعاد الرسم فور تغيّرها.
- **اختصارات المفاتيح**: تم فحصها وتحسين تسلسل المعالجات (Space لإيقاف/تشغيل التمرير التلقائي، Ctrl+F/B/S).
- **حذف الشريط الأفقي للمصغّرات**: تركنا العمودي فقط.
- **جودة PDF**: `maxSize` صار 4000px بجودة 95% بشكل افتراضي؛ `exportDocAsPdf` يسمح بمقياس حتى 2x الأصل. Sliders تصل إلى 6000px و 98%.
- **مستويات العناوين**: أُلغي حقل «المستوى» في `HeadingModal`. تصدير Word للعناوين يستخدم مستوى واحداً.

### إضافات
- **فقاعات تعليق حرّة**: `openAddComment` يفعّل `bubbleAddMode`، النقر على المخطوط يفتح مودال تعليق مع تخزين إحداثيات (x,y) نسبية (0..1). الفقاعة تظهر فوق المخطوط، النقر عليها يعرض النص + أزرار نسخ العزو/تعديل/حذف.
- **أداة اليد**: `handTool` state، عند التفعيل تصير المؤشر grab والسحب على المخطوط يحرّك scrollLeft/Top للـscroll container.
- **إغلاق تلقائي للقوائم المنسدلة** عند النقر على المخطوط عبر `onPageClick`.
- **إخفاء تلقائي للقوائم المنسدلة أثناء التمرير التلقائي** + زر عائم كبير «إيقاف · Space» في وسط أسفل الشاشة مع pulse animation.
- **زر X** على جميع القوائم المنسدلة والمودالات (البطاقة، التعليق، العنوان، العلامة المرجعية).
- **شريط المصغّرات قابل للسحب**: `mr-thumbs-resizer` مقبض على الحافة الداخلية، عرض قابل للتغيير 90-600px مع حفظ في localStorage.
- **مسطرة قابلة لكل شيء**: 3 أشكال (شريط/خط/متوازي)، ميلان ±15°، عرض 10-100%، محاذاة 3 خيارات، تمرير تلقائي بسرعة 0-120px/ث مع تشغيل/إيقاف.
- **حزمة Windows Portable v1.6.0** (~130MB) — عبر `/api/download/windows`.

## المكوّنات الفنية الجديدة
- `overridesRef` pattern: يقرأ `getViewport/render` أحدث قيمة في كل استدعاء بدلاً من التقاطها في closure.
- Pixel filter pipeline: `getImageData` → RGB invert loop → box blur 3×3 (denoise) → unsharp mask 3×3 (sharpen) → `putImageData`.
- Bubble comments: تُخزَّن مع `x, y` نسبيتين ومع `folio` تلقائي؛ متوافقة رجعياً مع التعليقات القديمة (line-based) التي تظل تعمل عبر قائمة التعليقات.

## قائمة الميزات المتبقية (اختيارية)
- P1: **حفظ جلسة العمل**: قائمة تبويبات مفتوحة قابلة للاستعادة (يتطلب file access API لاستعادة تلقائية).
- P2: مزامنة اللوحتين جنباً إلى جنب على السطر ذاته.
- P2: بحث نصي داخل التعليقات.
- P2: مطابقة نص مطبوع بمخطوط سطر بسطر.
- P2: OCR عربي.

## الاختبار
- ✅ Compilation: webpack compiled successfully.
- ✅ Toolbar V2: 7 أزرار + قوائم منسدلة + زر X على كل قائمة.
- ✅ Popover close X count = 1 عند فتح قائمة واحدة.
- ✅ Electron: تم توليد `dist/win-unpacked/ManuscriptBrowser.exe` v1.6.0 + `dist/ManuscriptBrowser-Windows-Portable.zip` (~130MB).
- ⚠️ الاختبارات الفعلية لكل ميزة تحتاج تشغيل على Windows.
