// The article coordinator plus permanent failures and reset(); referenced at the end of the article.

/// Shares one in-flight initialization between every caller.
///
/// App delegates, scene connections, push handlers, and deep links all tend to
/// request the same startup work. A plain `isReady` flag cannot stop them from
/// overlapping, because an actor method may be re-entered at every `await`.
/// `RecoverableStartupCoordinator` stores the running `Task` itself, so later callers wait
/// on the same work instead of starting it again, and a finished value is
/// reused without rebuilding.
public actor RecoverableStartupCoordinator<Value: Sendable> {
    public typealias Builder = @Sendable () async throws -> Value

    /// Decides whether a build error is worth retrying on the next call.
    public typealias FailureClassifier = @Sendable (any Error) -> Bool

    private enum State {
        case idle
        case running(Task<Value, any Error>)
        case ready(Value)
        case failed(any Error)
    }

    private var state: State = .idle
    private let build: Builder
    private let isPermanentFailure: FailureClassifier

    /// - Parameters:
    ///   - isPermanentFailure: Returns `true` for errors that a retry cannot fix,
    ///     such as an unsupported local data format. The coordinator then keeps
    ///     rethrowing that error instead of rebuilding. Every other error is
    ///     treated as transient and the next call retries. Defaults to never.
    ///   - build: Produces the fully initialized value. It must return only after
    ///     every dependency is ready, so callers never observe a partially
    ///     initialized state.
    public init(
        isPermanentFailure: @escaping FailureClassifier = { _ in false },
        build: @escaping Builder
    ) {
        self.isPermanentFailure = isPermanentFailure
        self.build = build
    }

    /// Returns the initialized value, starting the build only when nothing is
    /// running and no result exists yet.
    ///
    /// Concurrent callers share the same build. A transient failure returns the
    /// coordinator to `idle`, so the next call retries. A permanent failure is
    /// stored and rethrown by every later call until `reset()`.
    public func start() async throws -> Value {
        switch state {
        case .ready(let value):
            return value

        case .failed(let error):
            throw error

        case .running(let task):
            return try await task.value

        case .idle:
            let task = Task { try await build() }
            // Record the task before the first suspension point so re-entrant
            // callers observe `.running` instead of starting a second build.
            state = .running(task)

            do {
                let value = try await task.value
                if case .running(let current) = state, current == task {
                    state = .ready(value)
                }
                return value
            } catch {
                if case .running(let current) = state, current == task {
                    state = isPermanentFailure(error) ? .failed(error) : .idle
                }
                throw error
            }
        }
    }

    /// Discards the current result so the next `start()` builds again.
    ///
    /// Use this after logout or an account switch, when the initialized value
    /// no longer belongs to the user. A build that is still running is
    /// cancelled; its callers receive the cancellation error, and its outcome
    /// is ignored so it cannot overwrite a newer build.
    public func reset() {
        if case .running(let task) = state {
            task.cancel()
        }
        state = .idle
    }
}
