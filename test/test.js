'use strict'
const test = require('tape')
const request = require('req-then')
const localWebServer = require('../')
const http = require('http')
const PassThrough = require('stream').PassThrough

function launchServer (app, options) {
  options = options || {}
  const path = `http://localhost:8100${options.path || '/'}`
  const server = http.createServer(app.callback())
  return server.listen(options.port || 8100, () => {
    const req = request(path, options.reqOptions)
    if (options.onSuccess) req.then(options.onSuccess)
    if (!options.leaveOpen) req.then(() => server.close())
    req.catch(err => console.error('LAUNCH ERROR', err.stack))
  })
}

function checkResponse (t, status, body) {
  return function (response) {
    if (status) t.strictEqual(response.res.statusCode, status)
    if (body) t.ok(body.test(response.data))
  }
}

test('static', function (t) {
  t.plan(1)
  const app = localWebServer({
    log: { format: 'none' },
    static: {
      root: __dirname + '/fixture',
      options: {
        index: 'file.txt'
      }
    }
  })
  launchServer(app, { onSuccess: response => {
    t.ok(/test/.test(response.data))
  }})
})

test('serve-index', function (t) {
  t.plan(2)
  const app = localWebServer({
    log: { format: 'none' },
    serveIndex: {
      path: __dirname + '/fixture',
      options: {
        icons: true
      }
    }
  })
  launchServer(app, { onSuccess: response => {
    t.ok(/listing directory/.test(response.data))
    t.ok(/class="icon/.test(response.data))
  }})
})

test('single page app', function (t) {
  t.plan(4)
  const app = localWebServer({
    log: { format: 'none' },
    static: { root: __dirname + '/fixture/spa' },
    spa: 'one.txt'
  })
  const server = launchServer(app, { leaveOpen: true })
  request('http://localhost:8100/test').then(response => {
    t.strictEqual(response.res.statusCode, 200)
    t.ok(/one/.test(response.data))
    request('http://localhost:8100/two.txt').then(response => {
      t.strictEqual(response.res.statusCode, 200)
      t.ok(/two/.test(response.data))
      server.close()
    })
  })
})

test('log: common', function (t) {
  t.plan(1)
  const stream = PassThrough()

  stream.on('readable', () => {
    let chunk = stream.read()
    if (chunk) t.ok(/GET/.test(chunk.toString()))
  })

  const app = localWebServer({
    log: {
      format: 'common',
      options: {
        stream: stream
      }
    }
  })
  launchServer(app)
})

test('compress', function (t) {
  t.plan(1)
  const app = localWebServer({
    compress: true,
    log: { format: 'none' },
    static: { root: __dirname + '/fixture' }
  })
  launchServer(
    app,
    {
      reqOptions: { headers: { 'Accept-Encoding': 'gzip' } },
      path: '/big-file.txt',
      onSuccess: response => {
        t.strictEqual(response.res.headers['content-encoding'], 'gzip')
      }
    }
  )
})

test('mime', function (t) {
  t.plan(2)
  const app = localWebServer({
    log: { format: 'none' },
    static: { root: __dirname + '/fixture' },
    mime: { 'text/plain': [ 'php' ] }
  })
  launchServer(app, { path: '/something.php', onSuccess: response => {
    t.strictEqual(response.res.statusCode, 200)
    t.ok(/text\/plain/.test(response.res.headers['content-type']))
  }})
})

test('forbid', function (t) {
  t.plan(2)
  const app = localWebServer({
    log: { format: 'none' },
    static: { root: __dirname + '/fixture/forbid' },
    forbid: [ '*.php', '*.html' ]
  })
  const server = launchServer(app, { leaveOpen: true })
  request('http://localhost:8100/two.php')
    .then(response => {
      t.strictEqual(response.res.statusCode, 403)
      request('http://localhost:8100/one.html')
        .then(response => {
          t.strictEqual(response.res.statusCode, 403)
          server.close()
        })
    })
})

test('rewrite: local', function (t) {
  t.plan(1)
  const app = localWebServer({
    log: { format: 'none' },
    static: { root: __dirname + '/fixture/rewrite' },
    rewrite: [ { from: '/two.html', to: '/one.html' } ]
  })
  launchServer(app, { path: '/two.html', onSuccess: response => {
    t.ok(/one/.test(response.data))
  }})
})

test('rewrite: proxy', function (t) {
  t.plan(2)
  const app = localWebServer({
    log: { format: 'none' },
    static: { root: __dirname + '/fixture/rewrite' },
    rewrite: [ { from: '/test/*', to: 'http://registry.npmjs.org/$1' } ]
  })
  launchServer(app, { path: '/test/', onSuccess: response => {
    t.strictEqual(response.res.statusCode, 200)
    t.ok(/db_name/.test(response.data))
  }})
})

test('rewrite: proxy, two url tokens', function (t) {
  t.plan(2)
  const app = localWebServer({
    log: { format: 'none' },
    rewrite: [ { from: '/:package/:version', to: 'http://registry.npmjs.org/:package/:version' } ]
  })
  launchServer(app, { path: '/command-line-args/1.0.0', onSuccess: response => {
    t.strictEqual(response.res.statusCode, 200)
    t.ok(/command-line-args/.test(response.data))
  }})
})

test('rewrite: proxy with port', function (t) {
  t.plan(2)
  const one = localWebServer({
    log: { format: 'none' },
    static: { root: __dirname + '/fixture/one' }
  })
  const two = localWebServer({
    log: { format: 'none' },
    static: { root: __dirname + '/fixture/spa' },
    rewrite: [ { from: '/test/*', to: 'http://localhost:9000/$1' } ]
  })
  const server1 = http.createServer(one.callback())
  const server2 = http.createServer(two.callback())
  server1.listen(9000, () => {
    server2.listen(8100, () => {
      request('http://localhost:8100/test/file.txt').then(response => {
        t.strictEqual(response.res.statusCode, 200)
        t.ok(/one/.test(response.data))
        server1.close()
        server2.close()
      })
    })
  })
})

test('mock: simple response', function (t) {
  t.plan(2)
  const app = localWebServer({
    log: { format: 'none' },
    mocks: [
      { route: '/test', response: { body: 'test' } }
    ]
  })
  launchServer(app, { path: '/test', onSuccess: response => {
    t.strictEqual(response.res.statusCode, 200)
    t.ok(/test/.test(response.data))
  }})
})

test('mock: method request filter', function (t) {
  t.plan(3)
  const app = localWebServer({
    log: { format: 'none' },
    mocks: [
      {
        route: '/test',
        request: { method: 'POST' },
        response: { body: 'test' }
      }
    ]
  })
  const server = http.createServer(app.callback())
  server.listen(8100, () => {
    request('http://localhost:8100/test')
      .then(checkResponse(t, 404))
      .then(() => request('http://localhost:8100/test', { data: 'something' }))
      .then(checkResponse(t, 200, /test/))
      .then(server.close.bind(server))
  })
})

test('mock: accepts request filter', function (t) {
  t.plan(3)
  const app = localWebServer({
    log: { format: 'none' },
    mocks: [
      {
        route: '/test',
        request: { accepts: 'text' },
        response: { body: 'test' }
      }
    ]
  })
  const server = http.createServer(app.callback())
  server.listen(8100, () => {
    request('http://localhost:8100/test', { headers: { Accept: '*/json' }})
      .then(checkResponse(t, 404))
      .then(() => request('http://localhost:8100/test', { headers: { Accept: 'text/plain' }}))
      .then(checkResponse(t, 200, /test/))
      .then(server.close.bind(server))
  })
})

test('mock: responses array', function (t) {
  t.plan(4)
  const app = localWebServer({
    log: { format: 'none' },
    mocks: [
      {
        route: '/test',
        responses: [
          { request: { method: 'GET' }, response: { body: 'get' } },
          { request: { method: 'POST' }, response: { body: 'post' } }
        ]
      }
    ]
  })
  const server = http.createServer(app.callback())
  server.listen(8100, () => {
    request('http://localhost:8100/test')
      .then(checkResponse(t, 200, /get/))
      .then(() => request('http://localhost:8100/test', { method: 'POST' }))
      .then(checkResponse(t, 200, /post/))
      .then(server.close.bind(server))
  })
})

test('mock: response function', function (t) {
  t.plan(4)
  const app = localWebServer({
    log: { format: 'none' },
    mocks: [
      {
        route: '/test',
        responses: [
          { request: { method: 'GET' }, response: ctx => ctx.body = 'get' },
          { request: { method: 'POST' }, response: ctx => ctx.body = 'post' }
        ]
      }
    ]
  })
  const server = http.createServer(app.callback())
  server.listen(8100, () => {
    request('http://localhost:8100/test')
      .then(checkResponse(t, 200, /get/))
      .then(() => request('http://localhost:8100/test', { method: 'POST' }))
      .then(checkResponse(t, 200, /post/))
      .then(server.close.bind(server))
  })
})

test('mock: response function args', function (t) {
  t.plan(2)
  const app = localWebServer({
    log: { format: 'none' },
    mocks: [
      {
        route: '/test/:one',
        responses: [
          { request: { method: 'GET' }, response: (ctx, one) => ctx.body = one }
        ]
      }
    ]
  })
  const server = http.createServer(app.callback())
  server.listen(8100, () => {
    request('http://localhost:8100/test/yeah')
      .then(checkResponse(t, 200, /yeah/))
      .then(server.close.bind(server))
  })
})
