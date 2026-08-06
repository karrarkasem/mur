# MUR Business Platform

نسخة أولية تجمع بين:

- موقع تعريفي عام
- نموذج طلب دراسة
- Firebase Firestore
- Firebase Authentication
- صفحة تسجيل دخول
- Dashboard أولية
- GitHub Pages

## خطوات الإعداد

1. أنشئ مشروع Firebase.
2. فعّل Authentication > Email/Password.
3. أنشئ Firestore Database.
4. انسخ إعدادات Firebase إلى:
   `firebase/firebase-config.js`
5. أنشئ مستخدمًا في Firebase Authentication.
6. أضف مستندًا داخل collection باسم `users`.
7. اجعل اسم المستند هو UID للمستخدم.
8. أضف الحقول التالية:

```json
{
  "name": "Admin",
  "email": "admin@example.com",
  "role": "admin",
  "active": true
}
```

9. انسخ محتوى `firestore.rules` إلى Firestore Rules.
10. ارفع المشروع إلى GitHub.
11. فعّل GitHub Pages من Settings > Pages.

## الأدوار المقترحة

- admin
- manager
- sales
- marketing
- technician
- viewer

## ملاحظة

هذه نسخة MVP أولية، وليست النسخة النهائية.
