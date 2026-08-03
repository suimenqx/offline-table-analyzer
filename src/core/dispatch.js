OTA.define('dispatch', ["store"], ({Store}) => {
/* dispatch — thin command bus between UI controllers and Store.

   Every UI→state mutation goes through dispatch(action, payload).
   Controllers never call Store methods directly.

   Usage:
     import { dispatch } from 'dispatch';
     dispatch('tab:create');
     dispatch('source:changed', { text: 'hello' });
*/

const dispatch = (action, payload) => Store.transition(action, payload);

    return { dispatch };
});
