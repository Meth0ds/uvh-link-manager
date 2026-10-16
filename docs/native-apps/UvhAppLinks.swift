import Foundation

/// Integration example. Never route from an incoming URL before resolve() succeeds.
/// Your app must independently authorize the signed-in user's access to its content.
public final class UvhAppLinks: Sendable {
    private final class RedirectGuard: NSObject, URLSessionTaskDelegate, Sendable {
        func urlSession(_ session: URLSession, task: URLSessionTask,
            willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
            completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
            completionHandler(nil)
        }
    }
    public enum Result: Sendable {
        case content(route: String, webURL: URL)
        case web(URL)
        case passwordRequired
        case unavailable
    }
    public struct Opening: Sendable {
        fileprivate let url: URL
        fileprivate let attemptID: UUID
        fileprivate var grant: String?
        fileprivate var challenge: String?
    }
    private struct Reply: Decodable {
        let kind: String
        let challenge: String?
        let route: String?
        let profileId: String?
        let webUrl: String?
        let grant: String?
    }
    private let resolverURL: URL
    private let host: String
    private let userAgent: String
    private let profileID: String
    private let allowedPrefixes: [String]
    private let session: URLSession
    public init(host: String, profileID: UUID, allowedPrefixes: [String], resolverOrigin: URL = URL(string: "https://uvh.es")!, userAgent: String = "UVH-AppLinks/1 (iPhone; Mobile)") {
        precondition(resolverOrigin.scheme == "https" && resolverOrigin.host != nil && resolverOrigin.user == nil && resolverOrigin.password == nil && resolverOrigin.query == nil && resolverOrigin.fragment == nil && ["", "/"].contains(resolverOrigin.path))
        self.resolverURL = URL(string: "/api/v1/app-links/resolve", relativeTo: resolverOrigin)!.absoluteURL
        self.userAgent = userAgent
        self.host = host.lowercased()
        self.profileID = profileID.uuidString.lowercased()
        self.allowedPrefixes = allowedPrefixes
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 12
        self.session = URLSession(configuration: config, delegate: RedirectGuard(), delegateQueue: nil)
    }
    /// Keep this Opening for password submission and network retries. Create a
    /// fresh one for a genuinely new user opening; never persist its secrets.
    public func opening(_ incoming: URL) -> Opening? {
        guard var c = URLComponents(url: incoming, resolvingAgainstBaseURL: false),
              c.scheme == "https", c.host?.lowercased() == host,
              c.user == nil, c.password == nil, c.port == nil,
              c.percentEncodedPath.range(of: #"^/a/[A-Za-z0-9_-]{1,64}$"#, options: .regularExpression) != nil,
              (c.queryItems ?? []).allSatisfy({ ["qr", "handoff"].contains($0.name) }) else { return nil }
        let fragment = URLComponents(string: "https://local.invalid/?" + (c.fragment ?? ""))
        let grant = fragment?.queryItems?.first(where: { $0.name == "grant" })?.value
        guard grant == nil || grant!.utf8.count <= 4096 else { return nil }
        c.fragment = nil
        guard let clean = c.url else { return nil }
        return Opening(url: clean, attemptID: UUID(), grant: grant, challenge: nil)
    }
    /// Call again with the SAME Opening on a timeout or after asking for a
    /// password. There is intentionally no offline/cached content fallback.
    public func resolve(_ opening: inout Opening, password: String? = nil) async throws -> Result {
        for _ in 0..<2 {
            let endpoint = resolverURL
            var payload: [String: String] = ["launchUrl": opening.url.absoluteString,
                "profileId": profileID, "attemptId": opening.attemptID.uuidString.lowercased()]
            if let challenge = opening.challenge { payload["challenge"] = challenge }
            if let grant = opening.grant { payload["grant"] = grant }
            if let password { payload["password"] = password }
            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.httpShouldHandleCookies = false
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
            request.setValue(Locale.preferredLanguages.prefix(8).joined(separator: ","), forHTTPHeaderField: "Accept-Language")
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, data.count <= 16_384,
                  http.mimeType == "application/json" else { return .unavailable }
            let reply = try JSONDecoder().decode(Reply.self, from: data)
            if http.statusCode == 202, reply.kind == "challenge_required", let challenge = reply.challenge {
                opening.challenge = challenge
                continue
            }
            if http.statusCode == 401, reply.kind == "password_required" { return .passwordRequired }
            guard http.statusCode == 200, let raw = reply.webUrl,
                  let web = URLComponents(string: raw), ["http", "https"].contains(web.scheme ?? ""),
                  web.host != nil, web.user == nil, web.password == nil, let webURL = web.url else { return .unavailable }
            guard let grant = reply.grant, !grant.isEmpty, grant.utf8.count <= 4096 else { return .unavailable }
            opening.grant = grant
            if reply.kind == "web" { return .web(webURL) }
            guard reply.kind == "content", reply.profileId?.lowercased() == profileID,
                  let route = reply.route,
                  route.range(of: #"^/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]*$"#, options: .regularExpression) != nil,
                  allowedPrefixes.contains(where: { route.hasPrefix($0) || route == String($0.dropLast()) }) else { return .unavailable }
            return .content(route: route, webURL: webURL)
        }
        return .unavailable
    }
}
