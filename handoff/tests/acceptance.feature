Feature: Qualia FM mobile radio
  These scenarios are requirements, not evidence of completed implementation.

  Scenario: Late generation cannot hijack a newer show
    Given generation A is running
    When the user cancels A and starts generation B
    And A returns a successful result after B
    Then only B may update the active show
    And A must never start audio

  Scenario: Skipping speech does not skip its track
    Given a licensed segment is speaking its introduction
    When the user selects Skip introduction
    Then speech stops
    And the same segment's track starts
    And only one audio owner is audible

  Scenario: Provider policy is server enforced
    Given Spotify integration and DJ approval gates are false
    When a client sends an override field or query parameter
    Then the server rejects the restricted operation
    And no Spotify or TTS operation bypasses the gate

  Scenario: Editorial payload contains no Spotify data
    Given a Spotify resolver returns metadata and account information
    When any LLM or TTS request is constructed
    Then no Spotify response fields, artwork, audio, lyrics, history or tokens are sent

  Scenario: Tune preserves the current song
    Given a song is playing with an upcoming queue
    When the user requests a softer atmosphere
    Then the current song continues
    And the old tail is retained until a valid replacement is ready
    And cancelling the request leaves the old tail unchanged

  Scenario: Mobile autoplay has a visible recovery
    Given the browser rejects playback with NotAllowedError
    Then the player displays a tappable resume control
    And the segment and phase remain intact
    And no hidden retry loop starts
