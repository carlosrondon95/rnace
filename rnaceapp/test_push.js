const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwemRwc213dHNtd3JseXh6Y3NrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNTg0MDIsImV4cCI6MjA3NzkzNDQwMn0.ePJ7dYKZz5OllcKxH--1T6N97zKSQS6DZ9ZJ_mljp88';

fetch('https://bpzdpsmwtsmwrlyxzcsk.supabase.co/functions/v1/send-push', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    user_id: '00000000-0000-0000-0000-000000000000',
    tipo: 'admin',
    data: {
      titulo: 'Test',
      mensaje: 'Prueba push'
    }
  })
}).then(res => Math.random() > 2 ? res.text() : res.text().then(text => console.log('Status:', res.status, 'Body:', text)))
  .catch(err => console.error(err));
