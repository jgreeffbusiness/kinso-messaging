import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

// Initialize Firebase Admin only once
const apps = getApps()
let adminApp;

if (!apps.length) {
  // Check for environment variables
  if (!process.env.FIREBASE_PROJECT_ID || 
      !process.env.FIREBASE_CLIENT_EMAIL || 
      !process.env.FIREBASE_PRIVATE_KEY) {
    console.error(
      'Missing Firebase Admin credentials. Check your environment variables.'
    )
  } else {
    adminApp = initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // The private key needs to have newlines replaced
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    })
  }
} else {
  adminApp = apps[0];
}

// Export auth only after initialization
export const adminAuth = getAuth(adminApp)

export default adminApp
