const crypto = require('hypercore-crypto')
const thunky = require('thunky')
const datenc = require('dat-encoding')
const path = require('path')

module.exports = {
  chainStorage,
  folderName,
  hex,
  asyncThunky
}

function chainStorage (parent) {
  return function (prefix) {
    if (typeof parent === 'function' || typeof parent === 'object') {
      return function (name) {
        return parent(path.join(prefix, name))
      }
    } else {
      return path.join(parent, prefix)
    }
  }
}

function hex (buf) {
  if (!Buffer.isBuffer(buf)) return buf
  return buf.toString('hex')
}

function folderName (type, key) {
  key = hex(key)
  const str = discoveryKey(key)
  return type + '/' + str
}

function discoveryKey (publicKey) {
  return crypto.discoveryKey(datenc.toBuf(publicKey)).toString('hex')
}

/**
 * An async wrapper for thunky
 *
 * Usage:
 * let ready = asyncThunky(_ready)
 *
 * Where _ready receives a callback as single argument
 * which has to be called after being done.
 *
 * Then, either call ready with a callback
 *    ready(cb)
 * or await it
 *    await ready()
 */
function asyncThunky (fn) {
  let thunk = thunky(fn)
  return function (cb) {
    if (cb) thunk(cb)
    else {
      return new Promise((resolve, reject) => {
        thunk(err => {
          if (err) reject(err)
          else resolve()
        })
      })
    }
  }
}