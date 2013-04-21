// @see https://github.com/jrburke/requirejs/blob/master/tests/nestedDefine/four.js
define(['two', 'three'], function (two, three) {
    return {
        name: 'four',
        twoName: two.name,
        threeName: three.name
    };
});