/**
 * Hello World — example AgentWork plugin (type: "tool")
 *
 * To install, copy this folder into ~/.agentwork/plugins/hello-world/
 *
 * Agents will be able to call this tool during task execution.
 * The handler receives the parsed input object and the current working directory.
 */

module.exports = {
  name: 'hello_world',
  description: 'A friendly greeting tool. Returns a hello message with the provided name.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The name to greet',
      },
    },
    required: ['name'],
  },

  /**
   * @param {object} input  - Parsed tool input matching the parameters schema above
   * @param {string} workDir - Absolute path to the current project working directory
   * @returns {string} The tool result that gets sent back to the agent
   */
  handler(input, workDir) {
    const greeting = `Hello, ${input.name}! This response comes from the hello-world plugin. Working directory: ${workDir}`;
    return greeting;
  },
};
