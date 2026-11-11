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
    ],
  },
};
