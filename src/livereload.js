
import promise from 'empty-promise'

const handshake = JSON.stringify({
  command: 'hello',
  protocols: [
    'http://livereload.com/protocols/official-7',
    'http://livereload.com/protocols/official-8',
    'http://livereload.com/protocols/2.x-origin-version-negotiation',
    'https://livereload.com/protocols/official-7',
    'https://livereload.com/protocols/official-8',
    'https://livereload.com/protocols/2.x-origin-version-negotiation',
  ],
})

// Instead of throwing. Let's provide some defaults that
// give consumer dev some feedback about missing dependency
// without completely failing.
const unimplemented = {
  onOpen: ()=> console.log('Missing onOpen listener.'),

  onClose: ()=> console.log('Missing onClose listener.'),

  onError: e=> {
    console.log('Error thrown, but no onError to pass it to.')
    console.error(e)
  },

  messenger: {
    message: msg=> console.log(
      'Missing messenger. \nmessage:',
      msg),
  },

  // This dependency is special. Can't even try to do
  // anything without it. So throw instead of warn.
  WebSocket: function (){
    throw 'Missing WebSocket constructor.'
  },

}
/**
 * Factory provider of a LiveReload client implentation
 *
 * @param {Number}    port        port for server
 *
 * @param {String}    host        hostname for server
 *
 * @param {Function}  onOpen      Callback after connection is
 *                                opened.
 *
 * @param {Function}  onClose     Callback after connection is
 *                                closed
 *
 * @param {Function}  onError     Callback after any error.
 *                                This module tries to suppress
 *                                thrown errors, and instead
 *                                passes them to onError.
 *
 * @param {Function} WebSocket   An implentation of WebSocket
 *
 * @param {Object}    messenger   An object with a `message`
 *                                method, which accepts an
 *                                object parameter.
 *
 * @return {Object}               API object with 2 methods:
 *                                `connect` and `disconnect`
 */
function makeLivereloadSocket ({
  // Seems reasonable to use LiveReload's default
  // port on localhost if none provided.
  port = 35729,
  host = 'localhost',
  onOpen = unimplemented.onOpen,
  onClose = unimplemented.onClose,
  onError = unimplemented.onError,
  messenger = unimplemented.messenger,
  WebSocket = unimplemented.WebSocket,
}) {

  const liveReload = {
      connect: connect,
      disconnect: disconnect
    }

  let socket

  function connect() {
    // nothing to do if already connected
    if ( socket && socket.readyState === 1) return

    try{
      socket = new WebSocket(
        `ws://${host}:${port}/livereload`)
    }
    catch(e) { return void onError(e) }

    socket.onmessage = hello
    socket.onerror = onError // consumer provided callback
    socket.onclose = onClose // consumer provided callback

    socket.onopen = async () => onOpen()

    liveReload.connect = () => {
      console.log('Attempt to connect multiple time with the same socket')
    } //Override the connect function

    return socket
  }

  function onOpen() {

    socket.onopen = () => { /*Ignore duplicate calls if any*/ }

    const poll = (timeout) => (resolve, reject) => {
      if(socket.readyState === 1) {
        socket.send(handshake)
        resolve(true)
      } else if (timeout <= 0) {
        disconnect()
        resolve(false)
        onError(new Error('Timeout: WebSocket half-open too long.'))
      } else {
        setTimeout( () => {
            poll(timeout - 100 /*milliseconds*/)(resolve, reject) 
          },
          100 /*milliseconds*/)
      }
    }

    new Promise(poll(8000 /*milliseconds*/))
  }

  // Close the socket
  // Publicly exposed API method
  //
  function disconnect() {
    if (!socket)
      return void onError(
        new Error('Invalid Disconnect: Cannot close a '
          + 'socket that has never been opened.')
      )
    socket.close()
    liveReload.disconnect = () =>
      onError(new Error('Atempt to disconnect twice'))
    //Not sure why we return the socket and break the encapsulation here
    return socket 
  }

  // Try to parse JSON and pass any error to consumer
  //
  function parseMsg(evt) {
    let msg
    try { msg = JSON.parse(evt.data) }
    catch (e) { onError(
      new Error('Invalid JSON from LiveReload server.')
    )}
    return msg
  }

  // Must receive hello from server before other messages.
  //
  function hello(evt) {
    const msg = parseMsg(evt)

    if (!msg || msg.command !== 'hello') {
      onError(new Error('Invalid "hello" from server'))
      return void liveReload.disconnect()
    }

    socket.onmessage = evt=> {
      const msg = parseMsg(evt)
      if (!msg)
        return void liveReload.disconnect()

      if (msg.command === 'reload')
        messenger.message(msg)
    }

    // Finally reached state consumer would view as open
    onOpen() // consumer provided callback
  }

  return liveReload
}

export default makeLivereloadSocket
