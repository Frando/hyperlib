require('leaked-handles').set({
    fullStack: true, // use full stack traces
    timeout: 10000, // run every 30 seconds instead of 5.
    debugSockets: true // pretty print tcp thrown exceptions.
});

const tape = require('tape')
const ram = require('random-access-memory')

const { Library, Archive, HyperdriveWrapper } = require('..')

tape('basic hyperlib behaviour', async (t) => {
  const Hyperdrive = HyperdriveWrapper(ram)
  /* Test super basic HyperdriveWrapper properties */
  t.equal(typeof(Hyperdrive),'object')
  t.equal(typeof(Hyperdrive.hyperdrive),'object')
  t.equal(typeof(Hyperdrive.hyperdrive.db),'object')

  /***************************/
  /* Test creating a Library */
  const lib0 = Library(ram)
  t.deepEqual(lib0.archiveTypes, {})
  opts = { archiveTypes: Hyperdrive }
  const lib1 = Library(ram, opts)
  t.deepEqual(lib1.ready(), {})
  t.deepEqual(lib1.archiveTypes, Hyperdrive)

  t.equal(typeof(lib1.getArchiveConstructor('hyperdrive')), 'function')
  let errThrown = false
  try {
    lib1.getArchiveConstructor('foo')
  } catch (err) {
    t.deepEqual(err, Error('Archive type foo not registered.'))
    errThrown = true
  }
  t.equal(errThrown, true, 'lib1.getArchiveConstructor("foo") is expected to throw an Error')

  /****************************/
  /* Test creating an Archive */
  const archive1 = await lib1.createArchive('hyperdrive')
  t.equal(typeof(archive1), 'object')
  t.equal(typeof(archive1.key), 'string')
  t.equal(archive1.key.length, 64)
  t.deepEqual(archive1, lib1.archives[archive1.key])

  /**********************************************************/
  /* Test other library functions except addRemoteArchive() */
  t.deepEqual(lib1.getArchive(archive1.key), archive1)
  const archive2 = await lib1.createArchive('hyperdrive')
  let archives = {}
  archives[archive1.key] = archive1
  archives[archive2.key] = archive2
  t.deepEqual(lib1.getArchives(), archives)
  t.deepEqual(lib1.getArchiveInstance(archive1.key), archive1.instance)
  const archive3 = await lib1.createArchive('hyperdrive', {}, { primary: false })
  t.deepEqual(archive3.getState(), { primary: false, parent: null, authorized: true, loaded: true, share: false } )
  const primaryArchives = await lib1.getPrimaryArchives()
  t.deepEqual(primaryArchives, [archive1, archive2])

  /***************************/
  /* Test sharing an Archive */

  const libB = Library(ram, opts)
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
