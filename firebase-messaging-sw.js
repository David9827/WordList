/* Service worker cho Firebase Cloud Messaging (nhận thông báo nền) */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBBasOgH-wV6LewNS8yEq3Lx_NvBRvP9Q8",
  authDomain: "wordlist-c3473.firebaseapp.com",
  projectId: "wordlist-c3473",
  storageBucket: "wordlist-c3473.firebasestorage.app",
  messagingSenderId: "113755459082",
  appId: "1:113755459082:web:e5157fd37e071a5e70d9f3"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload){
  const n = payload.notification || {};
  self.registration.showNotification(n.title || 'Ôn từ vựng', {
    body: n.body || 'Đến giờ ôn từ vựng!',
    tag: 'vocab-review',
    data: (payload.fcmOptions && {link: payload.fcmOptions.link}) || payload.data || {}
  });
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  const url = (event.notification.data && event.notification.data.link) || 'https://david9827.github.io/WordList/';
  event.waitUntil(clients.openWindow(url));
});
