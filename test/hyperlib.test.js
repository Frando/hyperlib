require('leaked-handles').set({
    fullStack: true, // use full stack traces
    timeout: 5000, // run every 30 seconds instead of 5.
    debugSockets: true // pretty print tcp thrown exceptions.
});

const tape = require('tape')
const ram = require('random-access-memory')
const datenc = require('dat-encoding')
const fs = require('fs')

const Library = require('../library')
const Archive = require('../archive')
const HyperdriveWrapper = require('../wrappers/hyperdrive')
const Hyperdrive = HyperdriveWrapper(ram)

tape('basic HyperdriveWrapper', async (t) => {
  t.equal(typeof(Hyperdrive),'object')
  t.equal(typeof(Hyperdrive.hyperdrive),'object')
  t.equal(typeof(Hyperdrive.hyperdrive.db),'object')
  t.equal(typeof(Hyperdrive.setInfo), 'function')
  t.end()
})

tape('create Library and register HyperdriveWrapper as archiveType', async (t) => {
  const lib0 = Library(ram)
  t.deepEqual(lib0.archiveTypes, {})
  opts = { archiveTypes: { hyperdrive: Hyperdrive } }
  const lib1 = Library(ram, opts)
  t.deepEqual(lib1.ready(), {})
  t.deepEqual(lib1.archiveTypes['hyperdrive'], Hyperdrive)
  t.end()
})

tape('library: getArchiveConstructor', async (t) => {
  const lib = Library(ram, { archiveTypes: { hyperdrive: Hyperdrive } })

  t.equal(typeof(lib.getArchiveConstructor('hyperdrive')), 'function')
  let errThrown = false
  try {
    lib.getArchiveConstructor('foo')
  } catch (err) {
    t.deepEqual(err, Error('Archive type foo not registered.'))
    errThrown = true
  }
  t.equal(errThrown, true, 'library.getArchiveConstructor("foo") is expected to throw an Error')
  t.end()
})

tape('library: createArchive', async (t) => {
  const lib = Library(ram, { archiveTypes: { hyperdrive: Hyperdrive } })
  const archive = await lib.createArchive('hyperdrive')
  t.equal(typeof(archive), 'object')
  t.equal(typeof(archive.key), 'string')
  t.equal(archive.key.length, 64)
  t.deepEqual(archive, lib.archives[archive.key])
  t.end()
})

tape('library: various getArchive-functions', async (t) => {
  const lib = Library(ram, { archiveTypes: { hyperdrive: Hyperdrive } })

  const archive1 = await lib.createArchive('hyperdrive')
  t.deepEqual(lib.getArchive(archive1.key), archive1)

  const archive2 = await lib.createArchive('hyperdrive')
  let archives = {}
  archives[archive1.key] = archive1
  archives[archive2.key] = archive2
  t.deepEqual(lib.getArchives(), archives)
  t.deepEqual(lib.getArchiveInstance(archive1.key), archive1.instance)

  const archive3 = await lib.createArchive('hyperdrive', {}, { primary: false })
  t.deepEqual(archive3.getState(), { primary: false, parent: null, authorized: true, loaded: true, share: false } )
  const primaryArchives = await lib.getPrimaryArchives()
  t.deepEqual(primaryArchives, [archive1, archive2])
  t.end()
})

tape('library & archive: sharing archives', async (t) => {
  const lib1 = Library(ram, { archiveTypes: { hyperdrive: Hyperdrive } })
  const archive1 = await lib1.createArchive('hyperdrive')
  const libB = Library(ram, { archiveTypes: { hyperdrive: Hyperdrive } })

  t.equal(typeof(libB.addRemoteArchive), 'function')
  archiveB = await libB.addRemoteArchive('hyperdrive', archive1.key)
  t.deepEqual(archiveB.getState(), { primary: true, parent: null, authorized: false, loaded: false, share: true })

  // establish listeners for network events
  let networkEvents = {
    archive1: {
      opened: false,
      peers: 0,
      closed: false
    },
    archiveB: {
      opened: false,
      peers: 0,
      closed: false
    }
  }
  archive1.on('networkOpened', (e) => {
    networkEvents.archive1.opened = e
  })
  archive1.on('got peer', (e) => {
    networkEvents.archive1.peers = e
  })
  archive1.on('networkClosed', (e) => {
    networkEvents.archive1.closed = e
  })
  archiveB.on('networkOpened', (e) => {
    networkEvents.archiveB.opened = e
  })
  archiveB.on('got peer', (e) => {
    networkEvents.archiveB.peers = e
  })
  archiveB.on('networkClosed', (e) => {
    networkEvents.archiveB.closed = e
  })

  // For what ever reason, network handles leak without this calls.
  // TODO: Correct this behaviour
  await archive1.getMounts()
  await archiveB.getMounts()

  t.equal(typeof(archive1.setShare), 'function', 'is archive.setShare() defined as function?')
  await archive1.setShare(true)
  t.deepEqual(
    await archive1.getState(),
    { primary: true, parent: null, authorized: true, loaded: true, share: true, localKey: archive1.key },
    'Does archive.setShare() result in archive.state.shared = true'
  )

  t.equal(await archiveB.isAuthorized(), false, 'is newly added archive unauthorized?')

  let buf1
  archiveB.instance.writeFile('/foo.txt', 'bar', (err) => {
    if (err) throw err
    archiveB.instance.readdir('/', (err, list) => {
      if (err) throw err
      archiveB.instance.readFile('/foo.txt', 'utf-8', (err, data) => {
        if (err) throw err
        buf1 = data
      })
    })
  })

  await archive1.authorizeWriter(await datenc.toStr(archiveB.db.local.key))

  let buf2
  archiveB.instance.writeFile('/hello.txt', 'world', (err) => {
    if (err) throw err
    archiveB.instance.readdir('/', (err, list) => {
      if (err) throw err
      archiveB.instance.readFile('/hello.txt', 'utf-8', (err, data) => {
        if (err) throw err
        buf2 = data
      })
    })
  })

  let timer = setTimeout(async () => {
    archive1.instance.readdir('/', (err, list) => {
      if (err) throw err
      archive1.instance.readFile('/foo.txt', 'utf-8', (err, data) => {
        t.equal(buf1, data, 'data synced from authorized archive to authorizing archive?')
      })
      archive1.instance.readFile('/hello.txt', 'utf-8', (err, data) => {
        t.equal(buf2, data, 'data synced from authorized archive to authorizing archive?')
      })
    })
    t.equal(await archiveB.isAuthorized(), true, 'Is authorization-information synced from authorizing to authorized archive?')
  }, 250)

  let timer1 = setTimeout(() => {
    t.deepEqual(
      archiveB.getState(),
      { primary: true, parent: null, authorized: true, loaded: true, share: true, localKey: datenc.toStr(archiveB.db.local.key) },
      'Does ArchiveB state match the performed tasks?'
    )
  }, 500)

  let interval = setInterval(() => {
    if (archive1.getState().loaded === true && archiveB.getState().loaded === true) {
      archive1.setShare(false)
      archiveB.setShare(false)
      clearInterval(interval)
    }
  }, 1000)

  let timer2 = setTimeout(() => {
    t.deepEqual(networkEvents,
      { archive1: { opened: true, peers: 1, closed: true },
        archiveB: { opened: true, peers: 1, closed: true } }
      , 'Were archive networks opened, closed and "got peer"-events fired?')
  }, 3000)

  t.end()
})

tape('archive: info', async (t) => {
  const lib = Library(ram, { archiveTypes: { hyperdrive: Hyperdrive } })
  archive = await lib.createArchive('hyperdrive')

  await archive.setInfo({ foo: 'bar' })
  const info = await archive.getInfo()
  t.equal(info['foo'] && info['foo']==='bar', true)
  t.end()
})

tape('archive: mounts', async (t) => {
  const lib = Library(ram, { archiveTypes: { hyperdrive: Hyperdrive } })
  archive = await lib.createArchive('hyperdrive')

  let mounts = await archive.getMounts()
  t.deepEqual(mounts, [])

  const archive01 = await archive.makePersistentMount('hyperdrive')
  t.equal(typeof(archive01), 'object', 'Has a hyperdrive been mounted to archive as subarchive?')
  await archive01.isAuthorized()
  t.deepEqual(await archive01.getState(), { primary: false, parent: archive.key, authorized: true, loaded: false, share: false, localKey: archive01.key } )
  await archive01.ready()
  console.log(archive01._loaded)
  t.deepEqual(await archive01.getState(), { primary: false, parent: archive.key, authorized: true, loaded: true, share: false, localKey: archive01.key } )

  archive.loadMounts() // no return value

  mounts = await archive.getMounts()
  const mountPrefix= mounts[0].prefix
  t.notEqual(mountPrefix, undefined, 'Does mount have a defined prefix?')
  const mount = await archive.getMount(mountPrefix)
  t.deepEqual([Object.keys(mounts[0]), mounts[0].key], [Object.keys(mount), mount.key], 'Do getMounts and getMount return same kind of objects?')

  const mountInstance = archive01.getMountInstance(mountPrefix)
  t.notDeepEqual(mountInstance, {})
  t.equal(mountInstance instanceof HyperdriveWrapper, true)

  t.equal(archive01.isPrimary(), false)
  archive01.setState({ primary: true })
  t.equal(archive01.isPrimary(), true)

  /*
  let archive1Info = await archive1.getInfo()
  t.deepEqual(archive1Info, {})
  await archive1.setInfo({ foo: 'bar' })
  let timeout = setTimeout( async () => {
    try {
      archive1Info = await archive1.getInfo()
    } catch (err) {
      archive1Info = err
    }
    t.deepEqual(archive1Info, { foo: 'bar' } || Error('Hyperdrive has not any setInfo()'))
  }, 500)
  */
  t.end()
})
