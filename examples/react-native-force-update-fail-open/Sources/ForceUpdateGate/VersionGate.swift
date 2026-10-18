public enum VersionGateDecision: Equatable, Sendable {
    case allow
    case requireUpdate
}

public struct SemanticVersion: Comparable, Sendable {
    public let major: Int
    public let minor: Int
    public let patch: Int

    public init?(_ rawValue: String) {
        let components = rawValue.split(separator: ".", omittingEmptySubsequences: false)
        guard components.count == 3,
              let major = Int(components[0]),
              let minor = Int(components[1]),
              let patch = Int(components[2]),
              major >= 0,
              minor >= 0,
              patch >= 0 else {
            return nil
        }

        self.major = major
        self.minor = minor
        self.patch = patch
    }

    public static func < (lhs: Self, rhs: Self) -> Bool {
        (lhs.major, lhs.minor, lhs.patch) < (rhs.major, rhs.minor, rhs.patch)
    }
}

public enum VersionGate {
    /// Invalid remote policy fails open so a malformed payload cannot block every user.
    public static func evaluate(
        current currentValue: String,
        minimum minimumValue: String
    ) -> VersionGateDecision {
        guard let current = SemanticVersion(currentValue),
              let minimum = SemanticVersion(minimumValue) else {
            return .allow
        }

        return current < minimum ? .requireUpdate : .allow
    }
}
