# RNACE - Comprehensive Sports Center Management

![Angular](https://img.shields.io/badge/Angular-20-DD0031?style=for-the-badge&logo=angular&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-5A0FC8?style=for-the-badge&logo=pwa&logoColor=white)

Progressive Web App (PWA) designed for the complete management of reservations,
users, and notifications for a high-performance sports center.

## 🚀 Key Features

### 📱 Native Experience (PWA)

- **Installable**: Works like a native app on iOS and Android when added to the
  home screen.
- **Push Notifications**: Integrated system with Firebase Cloud Messaging (FCM)
  to receive real-time alerts (reservations, cancellations, announcements) even
  when the app is closed.
- **Offline Support**: Intelligent resource caching for instant loading.

### 📅 Reservation Management

- **Interactive Calendar**: Clear visualization of available, full, and
  cancelled sessions.
- **Access Control (Plans)**: Automatic management of available classes based on
  the user's assigned plan (Focus/Reduced).
- **Smart Waitlist**:
  - Automatic spot assignment when a slot becomes available.
  - Priority notifications for users on the waitlist.

### 🛡️ Admin Panel

- **Profile & Schedule Management**: Control user roles (admin/teacher/client)
  and fixed schedule assignments.
- **Communication**: Send mass or segmented announcements (by group type) via
  Push notifications.
- **Analytics**: Quick view of occupancy and class status.

## 🛠️ Tech Stack

- **Frontend**: Angular 20 (Standalone Components, Signals).
- **Backend**: Supabase (PostgreSQL, Auth, Edge Functions).
- **Notifications**: Uses Supabase Edge Functions (`send-push`) connected to
  Firebase Cloud Messaging v1 HTTP API.
- **Deployment**: Netlify (Automated CI/CD).

## 📸 Screenshots

_(Add your app screenshots here: Calendar, User Profile, Admin Panel)_
