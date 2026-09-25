"""Check the measured split, including expected bypasses; this is not a parity gate."""


def validate(results, network):
    def require(condition, description):
        if not condition:
            raise ValueError("Observation mismatch: " + description)

    cases = {row["case"]: row["value"] for row in results}
    require(len(cases) == len(results), "duplicate native cases")

    def expect(case, value):
        require(cases.get(case) == value, case)

    def apis(case, route, storage=False):
        value = cases.get(case, {})
        require(isinstance(value, dict), case)
        require(value.get("fetch") == route and value.get("websocket") == "hmr:" + route, case)
        document = value.get("document", {})
        require(document.get("body") == route, case + " document")
        if storage:
            require(document.get("local") == route and document.get("cookie") == "route=" + route,
                    case + " storage")

    require(bool(results) and results[-1]["case"] == "complete", "final completion record")
    expect("complete", True)
    hosts = ["localhost", "127.0.0.1", "[::1]", "orca-proof.invalid"]
    for host in hosts:
        route = "A" if host in ("localhost", "orca-proof.invalid") else "DIRECT-BYPASS"
        expect("route-A-" + host, "loaded")
        apis("apis-A-" + host, route)
        for variant in ("empty-suffix", "explicit-hosts", "exclude-localhost-control"):
            expected = "DIRECT-BYPASS" if variant == "exclude-localhost-control" and host == "localhost" else route
            expect(variant + "-load-" + host, "loaded")
            apis(variant + "-apis-" + host, expected)
    expect("storage-B-before", {"cookie": "", "local": None})
    expect("storage-A-after", {"cookie": "route=A", "local": "A"})
    for case, route in (("apis-A-after-B", "A"), ("apis-A-after-foreground", "A"),
                        ("apis-B", "B"), ("route-B-survives", "B")):
        apis(case, route, storage=True)
    for case in ("same-url-A", "same-url-B", "reload-A", "reload-after-foreground", "content-blocker-load"):
        expect(case, "loaded")
    order = [row["case"] for row in results]
    lifecycle = ["lifecycle-ready", "lifecycle-background", "lifecycle-foreground", "apis-A-after-foreground"]
    require(all(case in order for case in lifecycle), "lifecycle callbacks present")
    require([order.index(case) for case in lifecycle] == sorted(order.index(case) for case in lifecycle),
            "lifecycle callback order")
    expect("content-blocker-compiled", True)
    require("content-blocker" not in cases, "no content rule compilation error")
    for host in ("127.0.0.1", "[::1]"):
        expect("content-blocker-subresources-" + host,
               {"fetch": "error:TypeError", "websocket": "error", "image": "error"})
        expect("native-policy-navigation-" + host, "blocked-by-native-policy")
        expect("listener-down-navigation-" + host, "loaded")
        apis("listener-down-apis-" + host, "DIRECT-BYPASS")
    mapped = "[::ffff:127.0.0.1]"
    expect("content-blocker-subresources-" + mapped,
           {"fetch": "DIRECT-BYPASS", "websocket": "hmr:DIRECT-BYPASS", "image": "error"})
    expect("native-policy-navigation-" + mapped, "loaded")
    for loss in ("tunnel-down", "listener-down"):
        expect(loss + "-fetch", "error:TypeError")
        expect(loss + "-websocket", "error")
    require(str(cases.get("listener-down-navigation")).startswith("error:"), "listener loss navigation")

    starts = [i for i, event in enumerate(network) if event.get("path") == "/?policy=1" and event.get("route") == "A"]
    controls = [i for i, event in enumerate(network) if event["event"] == "control"]
    require(len(starts) == 1 and len(controls) == 2 and starts[0] < controls[0], "policy/control interval")
    require([network[i]["path"] for i in controls] == ["/tunnel-down", "/listener-down"], "loss controls")
    policy = network[starts[0] + 1:controls[0]]
    direct = [event for event in policy if event.get("route") == "DIRECT-BYPASS"]
    require(len(direct) == 4 and all(event.get("host", "").startswith("[::ffff:7f00:1]:") for event in direct),
            "only mapped IPv6 reaches direct trap during policy interval")
    require(sorted(event.get("path", "websocket") for event in direct) ==
            sorted(["/fetch?policy=1", "/image?policy=1", "/?policy=1", "websocket"]), "mapped bypass mechanisms")
    socks = [event for event in network if event["event"] == "socks-connect"]
    require(all(event["host"] in ("localhost", "orca-proof.invalid") for event in socks), "no literal SOCKS targets")
    require(all(any(event["host"] == host for event in socks) for host in ("localhost", "orca-proof.invalid")),
            "original hostnames reach SOCKS")
    require(not any(event.get("route") == "DIRECT-BYPASS" and event.get("host", "").startswith("localhost:")
                    for event in network[controls[0]:]), "no hostname direct fallback after loss")
