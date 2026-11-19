import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-auth-'));
process.env.NODE_ENV = 'test'; process.env.STORAGE_MODE = 'local'; process.env.QUEUE_MODE = 'memory';
process.env.LOCAL_DATA_DIR = path.join(root, 'data'); process.env.UPLOADS_DIR = path.join(root, 'uploads'); process.env.BCRYPT_SALT_ROUNDS = '4';
async function run() {
  const {default: app} = await import('../app');
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const addr = server.address(); if (!addr || typeof addr === 'string') throw new Error('No address');
  const base = `http://127.0.0.1:${addr.port}/api/auth`;
  const post = async (route: string, body: object, token?: string) => {
    const response = await fetch(base + route, {method:'POST', headers:{'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {})}, body: JSON.stringify(body)});
    return {status: response.status, body: await response.json() as any};
  };
  try {
    const password = 'StrongPassword#2026';
    const registered = await post('/register', {name:'Test Person', email:'User.Name+tag@example.com', password, role:'admin'});
    assert.equal(registered.status, 201); assert.equal(registered.body.data.user.role, 'user'); assert.equal(registered.body.data.user.email, 'user.name+tag@example.com');
    assert.equal((await post('/register', {name:'Test Person', email:'USER.NAME+TAG@EXAMPLE.COM', password})).status, 409);
    assert.equal((await post('/login', {email:'user.name+tag@example.com', password:'wrong'})).status, 401);
    const login = await post('/login', {email:'USER.NAME+TAG@EXAMPLE.COM', password}); assert.equal(login.status, 200);
    const token = login.body.data.tokens.refreshToken;
    const rotated = await post('/refresh', {refreshToken: token}); assert.equal(rotated.status, 200); assert.notEqual(rotated.body.data.tokens.refreshToken, token);
    assert.equal((await post('/refresh', {refreshToken:token})).status, 401);
    assert.equal((await fetch(base + '/me', {headers:{Authorization:`Bearer ${rotated.body.data.tokens.accessToken}`}})).status, 200);
    assert.equal((await post('/logout', {}, rotated.body.data.tokens.accessToken)).status, 200);
    assert.equal((await post('/refresh', {refreshToken:rotated.body.data.tokens.refreshToken})).status, 401);
    assert.equal((await post('/forgot-password', {email:'user.name+tag@example.com'})).status, 503);
    const concurrent = await Promise.all([1,2].map(() => post('/register', {name:'Race User', email:'race@example.com', password})));
    assert.deepEqual(concurrent.map(r => r.status).sort(), [201,409]);
    console.log('Auth regression tests passed');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(root,{recursive:true,force:true}); }
}
run().catch(e => {console.error(e); process.exitCode = 1;});
