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
  let opts = {
    archiveTypes: {
      hyperdrive: Hyperdrive
    }
  }
  const lib1 = Library(ram, opts)
  const lib2 = Library(ram, opts)

  const archive1 = await lib1.createArchive('hyperdrive')
  const archive2 = await lib2.addRemoteArchive('hyperdrive', archive1.key)

  t.equal(archive2.getState().share, true)
  t.equal(archive2.getState().authorized, false)

  let stats1 = trackStats(archive1)
  let stats2 = trackStats(archive2)

  function trackStats (archive) {
    let stats = {
      opened: false,
      peers: false,
      closed: false
    }
    archive.on('network:open', () => { stats.opened = true })
    archive.on('network:close', () => { stats.closed = true })
    // Todo: When tracking peers as a number, it switches between 1 and 2 per test run.
    archive.on('network:peer', () => { stats.peers = true })
    return stats
  }

  await archive1.ready()
  await archive2.ready()

  // For what ever reason, network handles leak without this calls.
  // TODO: Correct this behaviour
  // Edit (Frando): Seems to be fixed by correctly closing the networks.
  // archive1.getMounts()
  // archive2.getMounts()

  await archive1.setShare(true)

  await archive2.instance.writeFile('/foo.txt', 'bar')
  let text = await archive2.instance.readFile('/foo.txt')
  t.equal(text.toString(), 'bar', 'file read on archive2')

  let auth = await archive2.isAuthorized()
  t.equal(auth, false, 'archive2 not authorized')

  await archive1.authorizeWriter(archive2.localKey)

  let steps = 0
  archive2.db.once('append', async () => {
    let auth = await archive2.isAuthorized()
    t.equal(auth, true, 'archive2 authorized')
    maybeNext(++steps)
  })

  archive1.db.once('append', async () => {
    let text = await archive1.instance.readFile('/foo.txt')
    t.equal(text.toString(), 'bar', 'file read on archive1 after sync')
    maybeNext(++steps)
  })

  function maybeNext (steps) {
    if (steps === 2) checkNetwork()
  }

  async function checkNetwork () {
    let expected = { opened: true, peers: true, closed: false }
    t.deepEqual(stats1, expected, 'archive1 open stats')
    t.deepEqual(stats2, expected, 'archive2 open stats')

    await archive1.stopShare()
    await archive2.stopShare()

    expected = { opened: true, peers: true, closed: true }
    t.deepEqual(stats1, expected, 'archive1 close stats')
    t.deepEqual(stats2, expected, 'archive2 close stats')
    t.end()
  }
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
  mounts = await archive.getMounts()
  t.deepEqual(archive01, mounts[0], 'Has a hyperdrive been mounted to archive as subarchive?')
  t.equal(archive01.getState().primary, false)
  t.equal(archive01.getState().parent, archive.key)
  t.equal(await archive01.isAuthorized(), true)
  t.equal(archive01.getState().loaded, true)

  const mountPrefix= mounts[0].prefix
  t.notEqual(mountPrefix, undefined, 'Does mount have a defined prefix?')
  const mount = await archive.getMount(mountPrefix)
  t.deepEqual([Object.keys(mounts[0]), mounts[0].key], [Object.keys(mount), mount.key], 'Do getMounts and getMount return same kind of objects?')

  const mountInstance = archive01.getMountInstance(mountPrefix)
  t.notDeepEqual(mountInstance, {}, 'Does archive.getMountInstance() return a defined value?')
  t.equal(mountInstance instanceof HyperdriveWrapper, true, 'Does archive.getMountInstance() return a hyperdrive as mounted?')

  t.equal(archive01.isPrimary(), false)
  archive01.setState({ primary: true })
  t.equal(archive01.isPrimary(), true)

  t.end()
})
