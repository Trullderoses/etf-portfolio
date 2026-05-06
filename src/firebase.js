import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDPYoepdsEGZxmXCtxyO9RcwPplHk3B9fM",
  authDomain: "etf-portfolio-44163.firebaseapp.com",
  projectId: "etf-portfolio-44163",
  storageBucket: "etf-portfolio-44163.firebasestorage.app",
  messagingSenderId: "647534653241",
  appId: "1:647534653241:web:c8a73e65b60225af6602e8"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
