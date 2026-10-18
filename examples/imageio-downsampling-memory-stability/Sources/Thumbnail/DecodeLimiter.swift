// Code shown in the article "imageio-downsampling-memory-stability".

// snippet:start limiter
actor DecodeLimiter {
    private let limit: Int
    private var running = 0
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(limit: Int) {
        precondition(limit > 0)
        self.limit = limit
    }

    func acquire() async {
        if running < limit {
            running += 1
            return
        }

        await withCheckedContinuation { continuation in
            waiters.append(continuation)
        }
    }

    func release() {
        if waiters.isEmpty {
            precondition(running > 0, "release() without acquire()")
            running -= 1
        } else {
            waiters.removeFirst().resume()
        }
    }
}
// snippet:end limiter
