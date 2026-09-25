package expo.modules.orcamobilewebshell

import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Pull-only I/O: no worker may enqueue a second chunk while JS owns the first. */
internal class BrowserLoopbackProxy : AutoCloseable {
  companion object {
    const val CHUNK_BYTES = 16 * 1024
    const val MAX_SOCKETS = 32
  }

  private class Peer(val socket: Socket) {
    var reading = false
    var writing = false
  }

  private val lock = Any()
  private val listener = ServerSocket(0, MAX_SOCKETS, InetAddress.getByAddress(byteArrayOf(127, 0, 0, 1)))
  private val workers = ThreadPoolExecutor(0, 65, 30, TimeUnit.SECONDS, SynchronousQueue<Runnable>())
  private val peers = mutableMapOf<Int, Peer>()
  private var accepting = false
  private var closed = false
  private var nextId = 1
  val port: Int get() = listener.localPort

  fun accept(done: (Result<Int>) -> Unit) {
    synchronized(lock) {
      check(!closed && !accepting && peers.size < MAX_SOCKETS) { "Proxy accept unavailable" }
      accepting = true
    }
    execute(done, { synchronized(lock) { accepting = false } }) {
      val socket = listener.accept()
      try {
        synchronized(lock) {
          if (closed || !socket.inetAddress.isLoopbackAddress) {
            socket.close()
            error("Proxy closed")
          }
          socket.tcpNoDelay = true
          socket.receiveBufferSize = CHUNK_BYTES
          socket.sendBufferSize = CHUNK_BYTES
          check(nextId < Int.MAX_VALUE) { "Proxy socket IDs exhausted" }
          val id = nextId++
          peers[id] = Peer(socket)
          id
        }
      } catch (error: Exception) {
        socket.close()
        throw error
      }
    }
  }

  fun read(id: Int, done: (Result<ByteArray?>) -> Unit) {
    val peer = claim(id, true)
    execute(done, { synchronized(lock) { peer.reading = false } }) {
      val bytes = ByteArray(CHUNK_BYTES)
      val count = peer.socket.getInputStream().read(bytes)
      if (count < 0) null else if (count == bytes.size) bytes else bytes.copyOf(count)
    }
  }

  fun write(id: Int, bytes: ByteArray?, done: (Result<Unit>) -> Unit) {
    require(bytes == null || bytes.size in 1..CHUNK_BYTES) { "Proxy chunk exceeds limit" }
    val peer = claim(id, false)
    execute(done, { synchronized(lock) { peer.writing = false } }) {
      if (bytes == null) peer.socket.shutdownOutput() else peer.socket.getOutputStream().write(bytes)
    }
  }

  private fun claim(id: Int, read: Boolean): Peer = synchronized(lock) {
    check(!closed) { "Proxy closed" }
    val peer = checkNotNull(peers[id]) { "Unknown proxy socket" }
    if (read) {
      check(!peer.reading) { "Proxy read already pending" }
      peer.reading = true
    } else {
      check(!peer.writing) { "Proxy write already pending" }
      peer.writing = true
    }
    peer
  }

  private fun <T> execute(done: (Result<T>) -> Unit, release: () -> Unit, action: () -> T) {
    try {
      workers.execute {
        val result = runCatching(action)
        release()
        done(result)
      }
    } catch (error: Exception) {
      release()
      done(Result.failure(error))
    }
  }

  fun closeSocket(id: Int) {
    val peer = synchronized(lock) { peers.remove(id) }
    peer?.socket?.close()
  }

  override fun close() {
    val sockets = synchronized(lock) {
      if (closed) return
      closed = true
      peers.values.map { it.socket }.also { peers.clear() }
    }
    listener.close()
    sockets.forEach { it.close() }
    workers.shutdown()
  }
}
