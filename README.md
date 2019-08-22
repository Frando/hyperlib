**NOTE: This is outdated and not developed further. Use (corestore)[https://github.com/andrewosh/corestore] and/or the [Dat SDK](https://github.com/datproject/sdk/) instaed.

# hyperlib

Manage many hyperdbs or hyperdb based modules (like hyperdrives). Archives can have mounts, pointers to other archives. 

*WIP and not yet stable!*

Example

```js
const storage = './db'
const archiveTypes = {
  hyperdrive: require('hyperlib/wrappers/hyperdrive')
}

const library = hyperlib(storage, { archiveTypes })

const archive = await library.createArchive('hyperdrive')
// share on network.
archive.setShare(true)
// add mount
archive.makePersistentMount('hyperdrive', 'my-mountpoint')

// add remote archive:

let key
const other = await library.addRemoteArchive('hyperdrive', key)

// if this would have mounts, they would be synced with the other archive.
// could be accessed like this:
let mounts = other.getMounts()
// or
let mount = other.getMount('my-mountpoint')
```
