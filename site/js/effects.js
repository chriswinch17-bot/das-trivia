/*
  WHAT HAPPENS AFTER EACH ANSWER
  ==============================
  This is the one file to change for reactions to a right answer, a wrong answer,
  or running out of time. Nothing else needs to be touched.

  For each of the three outcomes you can set:

    messages  The headline shown. One is picked at random each time.
    image     A picture or GIF to show. Put the file in the site/images folder and write
              its path here, e.g. "images/brick.gif". Use a list to pick one at random:
              ["images/brick1.gif", "images/brick2.gif"]. Leave as null for no image.
    sound     A sound to play, e.g. "sounds/buzzer.mp3". Leave as null for silence.
*/
window.EFFECTS = {
  correct: {
    messages: ["Swish!", "Bucket!", "Nothing but net!", "And one!"],
    image: null,
    sound: null,
  },
  // number questions only: the answer was close, so it earns partial points (orange)
  close: {
    messages: ["Off the glass!", "Rattled in!", "So close!"],
    image: null,
    sound: null,
  },
  wrong: {
    messages: ["Brick!", "Airball!", "Rejected!", "Off the rim!"],
    image: null,
    sound: null,
  },
  timeout: {
    messages: ["Shot clock violation!"],
    image: null,
    sound: null,
  },

  /*
    PICTURES FOR A SPECIFIC MANAGER
    When a question or its answer involves a manager listed here, one of their pictures is
    shown (picked at random) instead of the general image above. Put the files in
    site/images/managers/<name>/ and list them here.
  */
  /*
    VIDEO AFTER "SHARE RESULT"
    Plays full screen right after a player taps Share result (their score is copied first).
    Put the file in site/videos/ as an .mp4. Set this to null to switch the video off.
    "modes" picks which games show it: "trivia" is Das Trivia, "papo" is Papo Trade or NOT.
  */
  shareVideo: { file: "videos/share.mp4", modes: ["trivia", "papo", "team"] },

  /*
    WHAT TEAM AM I? — picture and song when a mystery team is guessed right
    Listed by manager. image: a picture in site/images/team/. song: an .mp3 in site/sounds/,
    e.g. song: { file: "sounds/joey.mp3", start: 42 } starts it 42 seconds in.
    The song stops when the player taps Next. Leave song as null for no song.
  */
  teamReveal: {
    joey: { image: "images/team/joey.webp", song: null },
  },

  managers: {
    victor: [
      "images/managers/victor/1.webp",
      "images/managers/victor/2.webp",
      "images/managers/victor/3.webp",
      "images/managers/victor/4.webp",
    ],
    papo: [
      "images/managers/papo/1.webp",
      "images/managers/papo/2.webp",
    ],
    libguel: [
      "images/managers/libguel/1.webp",
      "images/managers/libguel/2.png",
      "images/managers/libguel/3.webp",
    ],
    winch: [
      "images/managers/winch/1.webp",
      "images/managers/winch/2.webp",
    ],
    shueiro: [
      "images/managers/shueiro/1.webp",
    ],
    joey: [
      "images/managers/joey/1.webp",
    ],
    chalela: [
      "images/managers/chalela/1.webp",
    ],
  },
};
