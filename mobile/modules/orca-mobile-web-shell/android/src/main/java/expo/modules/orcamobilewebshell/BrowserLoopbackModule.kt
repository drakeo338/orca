package expo.modules.orcamobilewebshell

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.ModuleDefinitionBuilder

internal class BrowserLoopbackModule {
  private var proxy: BrowserLoopbackProxy? = null
  private var generation = 0

  private fun owned(route: Int): BrowserLoopbackProxy = synchronized(this) {
    check(route == generation) { "Obsolete proxy route" }
    checkNotNull(proxy) { "Proxy route closed" }
  }

  fun install(builder: ModuleDefinitionBuilder) = with(builder) {
    AsyncFunction("browserProxyStart") {
      synchronized(this@BrowserLoopbackModule) {
        check(proxy == null) { "Proxy route already owned" }
        val created = BrowserLoopbackProxy()
        proxy = created
        generation += 1
        mapOf("route" to generation, "port" to created.port)
      }
    }
    AsyncFunction("browserProxyAccept") { route: Int, promise: Promise ->
      owned(route).accept { settle(promise, it) }
    }
    AsyncFunction("browserProxyRead") { route: Int, socket: Int, promise: Promise ->
      owned(route).read(socket) { settle(promise, it) }
    }
    AsyncFunction("browserProxyWrite") { route: Int, socket: Int, bytes: ByteArray?, promise: Promise ->
      owned(route).write(socket, bytes) { result -> settle(promise, result.map { null }) }
    }
    Function("browserProxyCloseSocket") { route: Int, socket: Int ->
      owned(route).closeSocket(socket)
    }
    Function("browserProxyClose") { route: Int ->
      synchronized(this@BrowserLoopbackModule) {
        if (route == generation) close()
      }
    }
    OnDestroy { close() }
  }

  @Synchronized
  private fun close() {
    proxy?.close()
    proxy = null
  }

  private fun <T> settle(promise: Promise, result: Result<T>) {
    result.fold({ promise.resolve(it) }, { promise.reject("ERR_BROWSER_PROXY", it.message, it) })
  }
}
