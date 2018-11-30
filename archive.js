const EventEmitter = require('events').EventEmitter
const inherits = require('inherits')
const hyperdiscovery = require('hyperdiscovery')
const datenc = require('dat-encoding')

const { hex, asyncThunky, prom } = require('./util')

module.exports = Archive

function Archive (library, type, instance, state) {
  if (!(this instanceof Archive)) return new Archive(library, type, instance, state)
  const self = this
  this._opened = false

  this.instance = instance
  this.db = instance.db
  this.key = hex(instance.key)
  this.library = library
  this.state = state || {}
  this.type = type
  this.mounts = []

  this.ready = asyncThunky(this._ready.bind(this))
  this.ready()
}
inherits(Archive, EventEmitter)

Archive.prototype._ready = async function (done) {
  const self = this
  this.instance.ready(async () => {
    if (!self._opened) await init()
  })

  async function init () {
    self._opened = true
    await self.loadMounts()

    self.localKey = self.db.local.key
    self.setState({ localKey: datenc.toStr(self.localKey) })

    if (self.getState().share) {
      self.startShare()
    }

    // The following callback is executed once the hyperdb has any heads
    // available. For locally created dbs this is executed immediately,
    // for remote dbs once the first data comes in.
    self.db.heads(async () => {
      await self._isAuthorized()
      self.setState({ loaded: true })
      self.emit('loaded')
    })

    done()
  }
}

Archive.prototype.makePersistentMount = async function (type, prefix, key, opts) {
  await this.ready()
  if (!(await this.isAuthorized())) throw new Error('Archive is not writable.')
  const archive = await this.addMount({ type, prefix, key, opts })
  await this.instance.addMount({ type, prefix, key: archive.key })
  return archive
}

Archive.prototype.addMount = async function ({ type, prefix, key, opts }) {
  // todo: handle opts?
  opts = opts || {}
  const status = {
    primary: false,
    parent: this.key,
  }

  const archive = await this.library.addArchive(type, key, opts, status)
  const mountInfo = { prefix, type, key: archive.key }
  this.pushMount(mountInfo)
  return archive
}

Archive.prototype.pushMount = function (mount) {
  this.mounts.push(mount)
  this.emit('mount', mount)
}

Archive.prototype.loadMounts = async function () {
  const self = this
  await this.instance.ready()
  let mounts
  if (this.instance.getMounts) {
    mounts = await this.instance.getMounts()
    mounts.forEach(mount => self.addMount(mount))
  }
}

Archive.prototype.getMounts = async function () {
  await this.ready()
  if (!this.mounts) return []
  return this.mounts.map(mount => this.library.getArchive(mount.key))
}

Archive.prototype.getMount = async function (prefix) {
  await this.ready()
  const mounts = this.mounts.filter(m => m.prefix === prefix)
  if (mounts.length) return this.library.getArchive(mounts[0].key)
  return null
}

Archive.prototype.getMountInstance = async function (prefix) {
  const mount = await this.getMount(prefix)
  if (!mount) return null
  return mount.getInstance()
}

Archive.prototype.getInstance = function () {
  return this.instance
}

Archive.prototype.getInfo = async function () {
  if (this.instance.getInfo) return this.instance.getInfo()
  return {}
}

Archive.prototype.setInfo = async function (info) {
  if (!this.isLoaded()) return
  if (this.instance.setInfo) return this.instance.setInfo(info)
  this.emit('info:set', info)
  return null
}

Archive.prototype.getState = function () {
  return this.state
}

Archive.prototype.setState = function (state) {
  this.state = { ...this.state, ...state }
  this.emit('state:set', this.state)
}

Archive.prototype.isPrimary = function () {
  return this.state.primary
}

Archive.prototype.isLoaded = function () {
  return this.state.loaded
}

Archive.prototype.isAuthorized = async function () {
  await this.ready()
  return this._isAuthorized()
}

Archive.prototype._isAuthorized = async function () {
  const self = this
  return new Promise((resolve, reject) => {
    this.db.authorized(this.localKey, (err, res) => {
      if (err) reject(err)
      self.setState({ authorized: res })
      resolve(res)
    })
  })
}

Archive.prototype.setShare = async function (share) {
  this.setState({ share })
  if (share) {
    this.startShare()
  } else {
    this.stopShare()
  }
  return
}

Archive.prototype.startShare = async function () {
  await this.ready()
  const instance = this.getInstance()
  // todo: make pluggable.
  const network = hyperdiscovery(instance.db)
  this.network = network
  this.emit('network:open')
  network.on('connection', (peer) => {
    this.emit('network:peer', peer)
  })

  // todo: really always share all mounts? If decided compare with this.stopShare()!
  let mounts = await this.getMounts()
  mounts.forEach(mount => {
    mount.startShare()
  })
}

Archive.prototype.stopShare = async function () {
  await this.ready()
  if (!this.network) return

  const [promise, done] = prom()

  // Stop sharing mounts.
  let mounts = await this.getMounts()
  mounts.forEach(mount => {
    mount.stopShare()
  })

  // Close own network.
  this.network.close(() => {
    this.emit('network:close')
    done()
  })

  return promise
}

Archive.prototype.authorizeWriter = function (key) {
  const self = this
  const db = this.db
  return new Promise((resolve, reject) => {
    key = Buffer.from(key, 'hex')
    db.authorized(key, (err, auth) => {
      if (err) return reject(err)
      if (auth === true) {
        resolve(true)
      }
      db.authorize(key, async (err, res) => {
        if (err) return reject(err)
        if (res) {
          // Hack: Do a write after the auth is complete.
          // Without this, hyperdrive breaks when loading the stat
          // for the root folder (/). I think this is a bug in hyperdb.
          await self.setInfo({})
          resolve(true)
        }
      })
    })
  })
}
