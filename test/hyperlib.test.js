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
  // Test super basic HyperdriveWrapper properties
  t.equal(typeof(Hyperdrive),'object')
  t.equal(typeof(Hyperdrive.hyperdrive),'object')
  t.equal(typeof(Hyperdrive.hyperdrive.db),'object')

  // Test creating a Library
  opts = { archiveTypes: Hyperdrive }
  const lib1 = Library(ram, opts)
  t.deepEqual(lib1.archiveTypes, Hyperdrive)

  let archCon = lib1.getArchiveConstructor('hyperdrive')
  t.equal(typeof(archCon), 'function')

  // Test creating an Archive
  const archive1 = await lib1.createArchive('hyperdrive')
  t.equal(typeof(archive1), 'object')
  t.equal(typeof(archive1.key), 'string')
  t.equal(archive1.key.length, 64)
  t.deepEqual(archive1, lib1.archives[archive1.key])

  // Test sharing an Archive
  // TODO: close connection on setShare false
  t.equal(typeof(archive1.setShare), 'function')
  await archive1.setShare(true)
  t.deepEqual(archive1.getState(), { primary: true, parent: null, authorized: true, loaded: true, share: true })

  const lib2 = Library(ram, opts)
  t.equal(typeof(lib2.addRemoteArchive), 'function')
  archive2 = await lib2.addRemoteArchive('hyperdrive', archive1.key)
  t.deepEqual(archive2.getState(), { primary: true, parent: null, authorized: false, loaded: false, share: true })
  let timer = setTimeout(() => {
    t.deepEqual(
      archive2.getState(),
      { primary: true, parent: null, authorized: false, loaded: true, share: true })
  }, 500)



  /*
  archive1.setShare(false)
  state = archive1.getState()
  t.deepEqual(state, { primary: true, parent: null, authorized: true, loaded: true, share: false })
  */

  // close all opened remote connections to allow test to finish
  timer = setInterval(() => {
    if (archive2.getState().loaded === true) {
      archive1.stopShare()
      archive2.stopShare()
    }
    clearInterval(timer)
  }, 500)

  t.end()
})
