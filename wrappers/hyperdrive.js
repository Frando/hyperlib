const hyperdrive = require('hyperdrive')
const pify = require('pify')
const pump = require('pump')
const { hex } = require('../util')

module.exports = HyperdriveWrapper

function HyperdriveWrapper (storage, key, opts) {
  if (!(this instanceof HyperdriveWrapper)) return new HyperdriveWrapper(storage, key, opts)
  const self = this
  this.hyperdrive = hyperdrive(storage, key, opts)
  this.db = this.hyperdrive.db
  this.key = key
  this.discoveryKey = this.hyperdrive.discoveryKey

  this.info = null
  this.mounts = []

  // Copy functions from hyperdrive.
  const asyncFuncs = ['ready', 'readFile', 'writeFile', 'readdir', 'mkdir', 'stat', 'authorize']
  asyncFuncs.forEach(func => {
    self[func] = pify(self.hyperdrive[func].bind(self.hyperdrive))
  })
  const syncFuncs = ['createWriteStream', 'createReadStream', 'replicate']
  syncFuncs.forEach(func => {
    self[func] = self.hyperdrive[func].bind(self.hyperdrive)
  })

  this.ready = pify(this.hyperdrive.ready.bind(this.hyperdrive))

  this.asyncWriteStream = (path, stream) => {
    return new Promise((resolve, reject) => {
      const ws = this.hyperdrive.createWriteStream(path)
      pump(stream, ws)
      ws.on('finish', () => resolve(true))
      ws.on('error', (err) => reject(err))
    })
  }

  // Copy event bus.
  this.emit = (ev) => this.hyperdrive.emit(ev)
  this.on = (ev, cb) => this.hyperdrive.on(ev, cb)
  this.watch()
}

HyperdriveWrapper.prototype.watch = function () {
  const self = this
  this.db.watch('/', () => self.emit('change'))
}

// Workspace interface.

HyperdriveWrapper.prototype.addMount = async function (mount) {
  let existing = this.mounts.findIndex(({ key }) => key === mount.key)
  if (existing !== -1) this.mounts[existing] = mount
  else this.mounts.push(mount)
  await this.setInfo()
}

HyperdriveWrapper.prototype.getMounts = async function () {
  let info = await this.getInfo()
  if (info && info.archipel && info.archipel.mounts) {
    return info.archipel.mounts
  }
  return []
}

HyperdriveWrapper.prototype.setInfo = async function (info) {
  // await this.ready()
  // if (!this.db.authorized) throw new Error('Cannot setInfo if not authorized.')
  await this.getMounts()
  info = info || {}
  let defaultInfo = this.info || this.defaultInfo()
  info = Object.assign({}, defaultInfo, info)
  info.archipel.mounts = this.mounts
  this.info = info
  await this.writeFile('dat.json', JSON.stringify(info, null, 2))
}

HyperdriveWrapper.prototype.getInfo = function () {
  const self = this
  return new Promise(async (resolve, reject) => {
    if (self.info) return resolve(self.info)
    try {
      // For remote archives self will only resolve after the db has been synced.
      // Therefore, add a timeout
      let timeout = setTimeout(() => {
        resolve(self.defaultInfo())
      }, 500)

      let info = await self.readFile('dat.json')
      clearTimeout(timeout)
      self.info = JSON.parse(info.toString())
    } catch (e) {
      self.info = self.defaultInfo()
    }
    resolve(self.info)
  })
}

HyperdriveWrapper.prototype.defaultInfo = function () {
  const info = {
    url: 'dat://' + hex(this.key),
    key: hex(this.key),
    archipel: {
      type: 'archipel-hyperdrive-v1',
      mounts: []
    }
  }
  return info
}
