const firebaseConfig = {
    apiKey: 'AIzaSyBAHuGny5o6A97fbYJo4NS2GQwsgFAkKpo',
    authDomain: 'manna-marketplace.firebaseapp.com',
    projectId: 'manna-marketplace',
    storageBucket: 'manna-marketplace.firebasestorage.app',
    messagingSenderId: '316852627164',
    appId: '1:316852627164:web:e10be68a4ae22a1148b619',
    measurementId: 'G-7Q6KH9NST4'
};

const FIREBASE_APP_NAME = 'manna-marketplace-data';
let firebaseServices = null;

if (window.firebase) {
    const firebaseApp = window.firebase.apps.some((app) => app.name === FIREBASE_APP_NAME)
        ? window.firebase.app(FIREBASE_APP_NAME)
        : window.firebase.initializeApp(firebaseConfig, FIREBASE_APP_NAME);

    firebaseServices = {
        app: firebaseApp,
        auth: window.firebase.auth(firebaseApp),
        db: window.firebase.firestore(firebaseApp)
    };
} else {
    console.error('[Manna Marketplace] Firebase SDK is unavailable. Firestore mode cannot start.');
}

export { firebaseConfig, firebaseServices, FIREBASE_APP_NAME };