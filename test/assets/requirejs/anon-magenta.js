// @see https://github.com/jrburke/requirejs/blob/master/tests/anon/magenta.js
define(function (require, exports, module) {
    //This is a fakeout require("fake1");

    var red = require("red"),
        blue = require('./blue'),
        message = require('text!./message.txt');

    /*
     And another fakeoute require("fake2");
    */

    //Use ugly exports
    exports.name = red.name + blue.name;
    exports.path = require.toUrl('./foo.html');
    exports.message = message;
});