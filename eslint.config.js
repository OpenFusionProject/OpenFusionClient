var js = require("@eslint/js"); // Module to control application life.
var globals = require("eslint"); // Module to control application life.

var config = [
    { ignores: ["dist", "**/*.min.js"] },
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "commonjs",
            globals: {
                ...globals.node,
                ...globals.browser,
                process: true,
                __dirname: true,
                require: true,
                console: true,
                document: true,
                window: true,
                // these are for third party frontend libraries
                $: true,
                Snowflakes: true,
                uuidv4: true,
            },
            parserOptions: {
                ecmaVersion: "latest",
                ecmaFeatures: {},
                sourceType: "module",
            },
        },
        settings: {},
        plugins: {},
        rules: {
            ...js.configs.recommended.rules,
            "no-unused-vars": "warn",
            "prefer-const": "off",
            // "no-undef" will show up a lot due client functions being in separate files so they aren't aware of each other
            "no-undef": "warn",
        },
    },
];

module.exports = config;
