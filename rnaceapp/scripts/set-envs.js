const { writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');

const targetPath = join(__dirname, '../src/environments/environment.prod.ts');
const targetPathDev = join(__dirname, '../src/environments/environment.ts');

const envFileContent = `
export const environment = {
  production: true,
  supabaseUrl: '${process.env.SUPABASE_URL}',
  supabaseAnonKey: '${process.env.SUPABASE_ANON_KEY}',
  firebase: {
    apiKey: '${process.env.FIREBASE_API_KEY}',
    authDomain: '${process.env.FIREBASE_AUTH_DOMAIN}',
    projectId: '${process.env.FIREBASE_PROJECT_ID}',
    storageBucket: '${process.env.FIREBASE_STORAGE_BUCKET}',
    messagingSenderId: '${process.env.FIREBASE_MESSAGING_SENDER_ID}',
    appId: '${process.env.FIREBASE_APP_ID}'
  },
  firebaseVapidKey: '${process.env.FIREBASE_VAPID_KEY}'
};
`;

// Ensure environments directory exists (though it should be there)
// mkdirSync(join(__dirname, '../src/environments'), { recursive: true });

writeFileSync(targetPath, envFileContent);
console.log(`Output generated at ${targetPath}`);

writeFileSync(targetPathDev, envFileContent);
console.log(`Output generated at ${targetPathDev}`);
