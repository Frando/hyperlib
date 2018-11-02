const hyperdb = require('hyperdb')
const pify = require('pify')
const { hex } = require('../util')

module.exports = HyperDbWrapper

function HyperDbWrapper (storage, key) {
  if (!(this instanceof HyperDbWrapper)) return new HyperDbWrapper(storage, key)
  const self = this
  const opts = {
    valueEncoding: 'json',
    reduce: (a, b) => a
  }
  this.db = hyperdb(storage, key, opts)
  this.key = key
  this.discoveryKey = this.db.discoveryKey

  this.info = null
  this.mounts = []

  // Copy functions from hyperdrive.
  const asyncFuncs = ['ready', 'get', 'list', 'put', 'del']
  asyncFuncs.forEach(func => {
    self[func] = pify(self.db[func].bind(self.db))
  })
  const syncFuncs = ['createWriteStream', 'createReadStream', 'replicate']
  syncFuncs.forEach(func => {
    self[func] = self.db[func].bind(self.db)
  })

  this.ready = pify(this.db.ready.bind(this.db))

  // Copy event bus.
  this.emit = (ev) => this.db.emit(ev)
  this.on = (ev, cb) => this.db.on(ev, cb)
  // this.watch()
}

// ArchipelHyperDB.prototype.watch = function () {
//   const self = this
//   this.db.watch('/', () => self.emit('change'))
// }

// Workspace interface.

HyperDbWrapper.prototype.addMount = async function (mount) {
  this.mounts.push(mount)
  await this.put('mounts/' + mount.key, mount)
}

HyperDbWrapper.prototype.getMounts = async function () {
  let nodes = await this.list('mounts')
  if (!nodes || !nodes.length) return []
  return nodes.map(n => n.value)
}

HyperDbWrapper.prototype.setInfo = async function (info) {
  this.info = Object.assign({}, this.info ? this.info : {}, info)
  await this.put('info', this.info)
}

HyperDbWrapper.prototype.getInfo = function () {
  const self = this
  return new Promise(async (resolve, reject) => {
    if (self.info) return resolve(self.info)
    try {
      // For remote archives self will only resolve after the db has been synced.
      // Therefore, add a timeout
      let timeout = setTimeout(() => {
        resolve(self.defaultInfo())
      }, 500)

      let info = await self.get('info')
      clearTimeout(timeout)
      if (info.value) self.info = info.value
      else self.info = {}
    } catch (e) {
      self.info = self.defaultInfo()
    }
    resolve(self.info)
  })
}

HyperDbWrapper.prototype.defaultInfo = function () {
  const info = {
  }
  return info
}
