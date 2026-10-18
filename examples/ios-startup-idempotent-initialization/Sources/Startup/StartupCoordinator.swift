// The coordinator shown in the article "ios-startup-idempotent-initialization".

// snippet:start coordinator
import Foundation

struct AppServices: Sendable, Equatable {
    let sessionID: String?
}

actor StartupCoordinator {
    typealias Builder = @Sendable () async throws -> AppServices

    private enum State {
        case idle
        case running(Task<AppServices, Error>)
        case ready(AppServices)
    }

    private var state: State = .idle
    private let build: Builder

    init(build: @escaping Builder) {
        self.build = build
    }

    func start() async throws -> AppServices {
        switch state {
        case .ready(let services):
            return services

        case .running(let task):
            return try await task.value

        case .idle:
            let task = Task { try await build() }
            state = .running(task)

            do {
                let services = try await task.value
                state = .ready(services)
                return services
            } catch {
                state = .idle
                throw error
            }
        }
    }
}
// snippet:end coordinator
