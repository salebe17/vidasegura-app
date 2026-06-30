// Firebase Configuration for VidaSegura
// This file initializes all Firebase services used by the app

var FirebaseConfig = {
  apiKey: "AIzaSyAKHqpMvUeYPIB06WUNQ-AaC9nseaq5FhM",
  authDomain: "vidasegura-app.firebaseapp.com",
  databaseURL: "https://vidasegura-app-default-rtdb.firebaseio.com",
  projectId: "vidasegura-app",
  storageBucket: "vidasegura-app.firebasestorage.app",
  messagingSenderId: "1015899906852",
  appId: "1:1015899906852:web:9bb5950f6dc06465c849b1"
};

// Initialize Firebase
firebase.initializeApp(FirebaseConfig);

// Initialize services
var firebaseAuth = firebase.auth();
var firestore = firebase.firestore();
var realtimeDb = firebase.database();
// Firebase Storage requiere plan Blaze — no disponible en Spark
// var firebaseStorage = firebase.storage();

// Enable Firestore offline persistence
firestore.enablePersistence({ synchronizeTabs: true }).catch(function(err) {
  if (err.code === 'failed-precondition') {
    console.warn('[Firebase] Offline persistence failed: multiple tabs open');
  } else if (err.code === 'unimplemented') {
    console.warn('[Firebase] Offline persistence not supported by browser');
  }
});

console.log('[Firebase] Initialized successfully');
