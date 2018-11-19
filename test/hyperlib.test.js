require('leaked-handles').set({
    fullStack: true, // use full stack traces
    timeout: 10000, // run every 30 seconds instead of 5.
    debugSockets: true // pretty print tcp thrown exceptions.
});

const tape = require('tape')
const ram = require('random-access-memory')

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
  opts = { archiveTypes: Hyperdrive }
  const lib1 = Library(ram, opts)
  t.deepEqual(lib1.ready(), {})
  t.deepEqual(lib1.archiveTypes, Hyperdrive)
  t.end()
})

tape('library: getArchiveConstructor', async (t) => {
  const lib = Library(ram, { archiveTypes: Hyperdrive })

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
  const lib = Library(ram, { archiveTypes: Hyperdrive })
  const archive = await lib.createArchive('hyperdrive')
  t.equal(typeof(archive), 'object')
  t.equal(typeof(archive.key), 'string')
  t.equal(archive.key.length, 64)
  t.deepEqual(archive, lib.archives[archive.key])
  t.end()
})

tape('library: various getArchive-functions', async (t) => {
  const lib = Library(ram, { archiveTypes: Hyperdrive })

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
  const lib1 = Library(ram, { archiveTypes: Hyperdrive })
  const archive1 = await lib1.createArchive('hyperdrive')
  const libB = Library(ram, { archiveTypes: Hyperdrive })

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

  t.equal(typeof(archive1.setShare), 'function')
  await archive1.setShare(true)
  t.deepEqual(await archive1.getState(), { primary: true, parent: null, authorized: true, loaded: true, share: true })

  let timer1 = setTimeout(() => {
    t.deepEqual(archiveB.getState(), { primary: true, parent: null, authorized: false, loaded: true, share: true })
  }, 500)

  let interval = setInterval(() => {
    if (archiveB.getState().loaded === true) {
      archive1.setShare(false)
      archiveB.setShare(false)
    }
    clearInterval(interval)
  }, 500)

  let timer2 = setTimeout(() => {
    t.deepEqual(networkEvents,
      { archive1: { opened: true, peers: 1, closed: true },
        archiveB: { opened: true, peers: 1, closed: true } }
      , 'Were archive networks opened, closed and "got peer"-events fired?')
  }, 1000)

  t.end()
})


/*
tape('library: various getArchive-functions', async (t) => {
  console.log('archive1.instance.addMount', archive1.instance.addMount)
  try {
    const archive1a = await archive1.makePersistentMount('hyperdrive')
  } catch (err) {
    console.log(err)
  }
  t.equal(typeof(archive1a), 'object', 'Has a hyperdrive been mounted to archive as subarchive?')

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
  t.end()
})
*/
